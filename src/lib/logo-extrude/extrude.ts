/**
 * Logo-to-3D extrusion pipeline.
 *
 * Pipeline:
 *   1. sharp: crop (optional), flatten alpha against white, grayscale, threshold
 *      → eliminates gradient + transparency so potrace sees pure B&W edges.
 *   2. potrace: trace the bitmap → SVG path data.
 *   3. parseSvgPath: SVG path → array of polygon subpaths.
 *   4. classify each subpath as outer or hole via point-in-polygon nesting depth
 *      (even-odd fill rule, which is potrace's default).
 *   5. Build geom2: outer polygons MINUS hole polygons via JSCAD booleans.
 *   6. extrudeLinear in Z to give thickness.
 *   7. Rotate so the logo stands vertical (image-Y becomes world-Z height,
 *      thickness becomes Y depth). Center XYZ at origin.
 *   8. Uniform scale so the largest dimension matches `targetMaxDim`.
 *   9. Serialize to binary STL.
 *
 * Why not Meshy: Meshy text-to-3D doesn't know specific brand logos — it
 * improvises a generic vertical shape with a fenda. Meshy image-to-3D sees
 * the logo but produces a flat coin. This pipeline gives a deterministic,
 * print-quality plaque with true through-holes where the logo has open
 * interior regions.
 */
import potrace from 'potrace'
import sharp from 'sharp'
// @jscad/modeling is CommonJS without an "exports" map. Under ESM (Next/Turbopack
// and Node native ESM) the namespace shape is { colors, default }, with all the
// real modules nested under `.default`. Under CommonJS interop (tsx, ts-node)
// it gets flattened. We accept either shape.
import * as jscadNs from '@jscad/modeling'
import { serializeBinarySTL } from '@/lib/stl/serialize'

type JscadShape = {
  primitives: typeof import('@jscad/modeling').primitives
  booleans: typeof import('@jscad/modeling').booleans
  extrusions: typeof import('@jscad/modeling').extrusions
  transforms: typeof import('@jscad/modeling').transforms
  geometries: typeof import('@jscad/modeling').geometries
}
const jscad: JscadShape =
  ((jscadNs as unknown as { default?: JscadShape }).default ??
    (jscadNs as unknown as JscadShape))
import {
  parseSvgPath,
  pointInPolygon,
  signedArea,
  type Pt,
} from './parse-svg-path'
import { computeOtsuThreshold } from './otsu'

const { primitives, booleans, extrusions, transforms, geometries } = jscad
const { extrudeLinear } = extrusions

export interface CropBox {
  /** Pixel coordinates within the source image. All four values are required. */
  left: number
  top: number
  width: number
  height: number
}

export interface LogoExtrudeOptions {
  /** PNG/JPG/WEBP buffer */
  imageBuffer: Buffer
  /** Final largest-dimension target in mm (default 60) */
  targetMaxDim?: number
  /** Extrusion thickness in mm (default 8) */
  depthMm?: number
  /** Legacy: crop right portion of image (0..1). Prefer `cropBox` for arbitrary
   * rectangles. Kept for backward compatibility — ignored when `cropBox` is set. */
  cropFraction?: number
  /** Explicit pixel rectangle to extract before processing. Wins over `cropFraction`.
   * When set, auto-trim is skipped (the user already cropped tight). */
  cropBox?: CropBox
  /** Potrace turdSize — ignore speckles smaller than this many pixels. Default 8. */
  turdSize?: number
  /** Manual binarization threshold (0..255). When omitted, potrace's Otsu
   * auto-threshold is used. Override when auto produces a bad cut for THIS image. */
  threshold?: number
  /** Force polarity inversion regardless of mean-luminance auto-detect. */
  forceInvert?: boolean
  /** Skip the auto-trim step (e.g. user already cropped tight, no margins to remove). */
  skipTrim?: boolean
  /** Ignore inner contours and treat each outer subpath as a filled solid.
   * Useful for keychain-style cutouts where you want each LETTER cut through
   * as a solid shape, instead of just the thin OUTLINE of a letter.
   * Default: false (preserve letter counters faithfully). */
  ignoreHoles?: boolean
  /** Smarter alternative to `ignoreHoles`: per outer subpath, decide whether
   * to keep ALL or NONE of its holes based on the SUM of hole areas.
   *
   * If the total area of all holes inside an outer is >= this fraction of
   * the outer's area, the outer is an OUTLINED design (the holes represent
   * significant negative space) → all holes preserved → annular cut.
   *
   * Otherwise, the outer is a FILLED letter with minor counters → all holes
   * dropped → solid letter cut.
   *
   * Range 0..1. 0 = preserve all holes (default), 1 = ignore all holes (same
   * as `ignoreHoles: true`). Recommended: 0.3 for keychains/coasters.
   *
   * Why per-outer sum (not per-hole): an outlined monogram (PG) may have 2-3
   * separate counters each ~30% of the outer. Filtering each individually
   * with threshold 0.4 drops all → solid blob (bad). Summing gives ~90% →
   * preserves all → correct outline cut. */
  ignoreHolesSmallerThan?: number
}

export interface LogoExtrudeResult {
  stl: Uint8Array
  meta: {
    subpaths: number
    outers: number
    holes: number
    bboxMm: { x: number; y: number; z: number }
  }
}

export async function extrudeLogo(opts: LogoExtrudeOptions): Promise<LogoExtrudeResult> {
  const targetMaxDim = opts.targetMaxDim ?? 60
  const depthMm = opts.depthMm ?? 8
  const cropFraction = opts.cropFraction ?? 1
  const turdSize = opts.turdSize ?? 8
  const manualThreshold = opts.threshold // undefined = use Otsu
  const forceInvert = opts.forceInvert
  const skipTrim = opts.skipTrim ?? !!opts.cropBox
  const ignoreHoles = opts.ignoreHoles ?? false
  const ignoreHolesSmallerThan = opts.ignoreHolesSmallerThan ?? 0

  // Step 1: preprocess
  const meta = await sharp(opts.imageBuffer).metadata()
  const fullWidth = meta.width ?? 0
  const fullHeight = meta.height ?? 0
  if (!fullWidth || !fullHeight) {
    throw new Error('Could not read image dimensions')
  }

  // Step 1a: determine the extraction rectangle.
  // Priority: explicit cropBox > legacy cropFraction > full image.
  const rect = opts.cropBox
    ? {
        left: Math.max(0, Math.min(fullWidth - 1, Math.round(opts.cropBox.left))),
        top: Math.max(0, Math.min(fullHeight - 1, Math.round(opts.cropBox.top))),
        width: Math.max(1, Math.min(fullWidth, Math.round(opts.cropBox.width))),
        height: Math.max(1, Math.min(fullHeight, Math.round(opts.cropBox.height))),
      }
    : { left: 0, top: 0, width: Math.max(1, Math.floor(fullWidth * cropFraction)), height: fullHeight }

  // Step 1b: produce a clean grayscale buffer. Flatten transparency against
  // white, then a light blur (sigma=0.8) to kill compression halos / checker
  // patterns without erasing fine logo detail (text, icons, etc).
  //
  // Earlier value sigma=2 was aggressive and worked for JPG screenshots with
  // baked-in transparency checker patterns, but it also smudged thin strokes
  // and small letters. sigma=0.8 is the smallest that still cleans up
  // checker patterns while keeping crisp logo edges.
  let grayscale = await sharp(opts.imageBuffer)
    .extract(rect)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .blur(0.8)
    .toBuffer()

  // Step 1c: polarity check from the RAW grayscale histogram. If the image
  // has more dark pixels than light, the background is dark — invert so the
  // strokes/shapes end up dark (which is what potrace treats as material).
  // Caller can override via forceInvert.
  let inverted = false
  if (forceInvert === true) {
    grayscale = await sharp(grayscale).negate({ alpha: false }).toBuffer()
    inverted = true
  } else if (forceInvert === false) {
    // explicitly do nothing
  } else {
    const grayStats = await sharp(grayscale).stats()
    const grayMean = grayStats.channels[0]?.mean ?? 127
    if (grayMean < 127) {
      grayscale = await sharp(grayscale).negate({ alpha: false }).toBuffer()
      inverted = true
    }
  }

  // Step 1d: trim uniform background so the content fills the bbox.
  // Skipped if the caller cropped explicitly (likely already tight).
  //
  // Threshold 35 is permissive enough to cut through anti-aliased halos and
  // partial transparency, so the resulting bbox is tight on the real logo
  // (without halo padding around the strokes).
  if (!skipTrim) {
    try {
      grayscale = await sharp(grayscale).trim({ threshold: 35 }).toBuffer()
    } catch {
      // If trim fails (uniform image), keep as-is.
    }
  }
  void inverted

  // Step 2: trace. If caller passed an explicit threshold, use it. Otherwise
  // compute Otsu's threshold ourselves so the preview UI (which uses the same
  // function) and the final extrude agree on the exact value.
  let traceThreshold: number
  if (manualThreshold !== undefined) {
    traceThreshold = manualThreshold
  } else {
    const rawBytes = await sharp(grayscale).raw().toBuffer()
    traceThreshold = computeOtsuThreshold(new Uint8Array(rawBytes))
  }
  const svg: string = await new Promise((resolve, reject) => {
    potrace.trace(
      grayscale,
      {
        turdSize,
        alphaMax: 1,
        optCurve: true,
        optTolerance: 0.2,
        threshold: traceThreshold,
      },
      (err, s) => (err ? reject(err) : resolve(s)),
    )
  })

  const dMatch = svg.match(/\sd="([^"]+)"/)
  if (!dMatch) throw new Error('Potrace produced SVG with no path data')

  // Step 3: parse, then flip Y (SVG Y down → math Y up)
  const subpathsRaw = parseSvgPath(dMatch[1])
  if (subpathsRaw.length === 0) throw new Error('Trace produced no subpaths')

  const subpaths: Pt[][] = subpathsRaw.map((sp) => sp.map(([x, y]) => [x, -y] as Pt))

  // Step 4: classify by even-odd nesting depth using point-in-polygon
  // A subpath is OUTER (depth 0, 2, 4...) when an even number of OTHER subpaths
  // contain its first vertex. It's a HOLE (depth 1, 3, ...) otherwise.
  // We also map each hole to its immediate parent outer (smallest enclosing).
  type SubpathInfo = { index: number; isOuter: boolean; parentIndex: number | null; poly: Pt[] }
  const infos: SubpathInfo[] = subpaths.map((sp, i) => {
    const probe = sp[0]
    const enclosers: number[] = []
    for (let j = 0; j < subpaths.length; j++) {
      if (i === j) continue
      if (pointInPolygon(probe, subpaths[j])) enclosers.push(j)
    }
    const depth = enclosers.length
    const isOuter = depth % 2 === 0
    // Parent for a hole: the encloser at depth = depth-1 (the smallest enclosing).
    // Heuristic: pick the encloser whose polygon has the smallest area among
    // those whose own depth has the correct parity (depth-1).
    let parentIndex: number | null = null
    if (!isOuter) {
      let bestArea = Infinity
      for (const j of enclosers) {
        const area = Math.abs(signedArea(subpaths[j]))
        if (area < bestArea) {
          bestArea = area
          parentIndex = j
        }
      }
    }
    return { index: i, isOuter, parentIndex, poly: sp }
  })

  // Build a map: outer index → its hole polygons
  const holesByOuter = new Map<number, Pt[][]>()
  for (const inf of infos) {
    if (!inf.isOuter && inf.parentIndex !== null) {
      const list = holesByOuter.get(inf.parentIndex) ?? []
      list.push(inf.poly)
      holesByOuter.set(inf.parentIndex, list)
    }
  }

  // Step 5: enforce winding (outer CCW, hole CW) then build geom2.
  //
  // JSCAD's geom2 expects outer polygons in counter-clockwise order and holes
  // in clockwise order. The `orientation` option on `polygon()` only hints at
  // the input — it does not reorder vertices. To avoid any ambiguity, we
  // physically reverse the vertex array when the actual winding doesn't match
  // the role.
  const ensureWinding = (poly: Pt[], wantCCW: boolean): Pt[] => {
    const ccw = signedArea(poly) > 0
    return ccw === wantCCW ? poly : [...poly].reverse()
  }

  // Step 5+6 combined: extrude EACH (outer minus its holes) into its OWN
  // geom3, collect them, then union in 3D at the very end. This is much more
  // robust than doing a 2D union of many shapes first — JSCAD's 2D booleans
  // can silently drop tiny / degenerate / non-overlapping polygons when
  // unioning a complex set, but 3D union of disjoint solids is well-defined.
  const extrudedPieces: ReturnType<typeof extrudeLinear>[] = []
  let droppedPieces = 0
  for (const inf of infos) {
    if (!inf.isOuter) continue
    try {
      const outerPts = ensureWinding(inf.poly, true)
      const outerPoly = primitives.polygon({ points: outerPts })
      // Decide which holes to keep for this outer:
      //   - ignoreHoles=true → drop all (legacy boolean)
      //   - ignoreHolesSmallerThan>0 → all-or-nothing based on SUM of holes:
      //     keep all if total hole area ≥ threshold * outer area, else drop all
      //   - default → keep all
      let holes: Pt[][]
      if (ignoreHoles) {
        holes = []
      } else if (ignoreHolesSmallerThan > 0) {
        const allHoles = holesByOuter.get(inf.index) ?? []
        const outerArea = Math.abs(signedArea(inf.poly))
        const totalHoleArea = allHoles.reduce(
          (s, h) => s + Math.abs(signedArea(h)),
          0,
        )
        const ratio = outerArea > 0 ? totalHoleArea / outerArea : 0
        holes = ratio >= ignoreHolesSmallerThan ? allHoles : []
      } else {
        holes = holesByOuter.get(inf.index) ?? []
      }
      let shape2D: ReturnType<typeof primitives.polygon> = outerPoly
      if (holes.length > 0) {
        const holeGeom2s = holes.map((h) =>
          primitives.polygon({ points: ensureWinding(h, false) }),
        )
        shape2D = booleans.subtract(outerPoly, ...holeGeom2s) as ReturnType<typeof primitives.polygon>
      }
      const piece = extrudeLinear({ height: 1 }, shape2D)
      extrudedPieces.push(piece)
    } catch (err) {
      droppedPieces++
      console.warn(`[logo-extrude] dropped piece #${inf.index}: ${(err as Error).message}`)
    }
  }
  if (extrudedPieces.length === 0) {
    throw new Error('All outer polygons failed to extrude — no geometry produced')
  }
  if (droppedPieces > 0) {
    console.warn(`[logo-extrude] dropped ${droppedPieces}/${infos.filter(i => i.isOuter).length} outer pieces during extrude`)
  }

  // Union in 3D. JSCAD handles disjoint solids cleanly here.
  const combined3D =
    extrudedPieces.length === 1
      ? extrudedPieces[0]
      : booleans.union(...extrudedPieces)

  // Step 7: rotate +90° around X so the logo stands up RIGHT-SIDE UP.
  //
  // Before rotation: logo lies on XY plane with image-X → mesh X and
  // image-Y_flipped → mesh Y (image-top at mesh +Y because of the -y flip
  // we did when parsing the SVG). Extrusion runs along mesh Z.
  //
  // rotateX(+π/2) maps (x, y, z) → (x, -z, y), so:
  //   - mesh X stays X
  //   - mesh Y (image-top region at +Y) → +Z  → image-top ends up at +Z (UP)
  //   - mesh Z (extrusion) → -Y → slab becomes thickness along the Y axis
  //
  // The viewer then applies its own rotateX(-π/2) to convert Z-up → Y-up for
  // three.js, ending with image-top at world +Y (up) and front face at world
  // +Z (toward camera). Logo reads right-side up.
  const standing = transforms.rotateX(Math.PI / 2, combined3D)

  // Step 8: compute bbox, center, scale.
  const polys = geometries.geom3.toPolygons(standing)
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (const p of polys) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0]
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1]
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2]
    }
  }
  const rawSizeX = maxX - minX
  const rawSizeY = maxY - minY
  const rawSizeZ = maxZ - minZ

  // After rotateX(-90°): Y axis is "depth" (was original Z=extrusion=1 unit).
  // We want depth = depthMm. Apply uniform scale so largest dim → targetMaxDim,
  // then separately stretch Y to match depthMm exactly.
  const maxDim = Math.max(rawSizeX, rawSizeY, rawSizeZ) || 1
  const baseScale = targetMaxDim / maxDim
  const targetDepthScale = depthMm / (rawSizeY * baseScale) // Y after baseScale
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2

  // Step 9: collect transformed triangle positions and serialize.
  const positions: number[] = []
  for (const poly of polys) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        const x = (v[0] - cx) * baseScale
        const y = (v[1] - cy) * baseScale * targetDepthScale
        const z = (v[2] - cz) * baseScale
        positions.push(x, y, z)
      }
    }
  }
  const stl = serializeBinarySTL(positions)

  // Final bbox after transform (for meta)
  const finalSizeX = rawSizeX * baseScale
  const finalSizeY = rawSizeY * baseScale * targetDepthScale
  const finalSizeZ = rawSizeZ * baseScale

  const outerCount = infos.filter((i) => i.isOuter).length
  return {
    stl,
    meta: {
      subpaths: subpaths.length,
      outers: outerCount,
      holes: subpaths.length - outerCount,
      bboxMm: { x: finalSizeX, y: finalSizeY, z: finalSizeZ },
    },
  }
}
