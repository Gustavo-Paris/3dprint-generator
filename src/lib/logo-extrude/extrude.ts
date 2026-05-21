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

/** HSV saturation (0..255) above which a pixel counts as "coloured ink". */
const COLOR_INK_SAT = 100
/** Min fraction of coloured-ink pixels for the saturation mask to kick in.
 *  Below this the logo is treated as monochrome (luminance path). */
const COLOR_INK_FRACTION = 0.01

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
  /** Potrace turdSize — ignore speckles smaller than this many pixels.
   *  Default 4 (compromise: filters anti-aliasing noise around stroke
   *  edges while preserving thin strokes in line-art monograms). */
  turdSize?: number
  /** Manual binarization threshold (0..255). When omitted, potrace's Otsu
   * auto-threshold is used. Override when auto produces a bad cut for THIS image. */
  threshold?: number
  /** Sharp pre-binarisation threshold (0..255). Pixels darker than this
   * become pure black before potrace; lighter become pure white. Default
   * 230 — robust for gradient / light-coloured logos. */
  binaryThreshold?: number
  /** Force polarity inversion regardless of mean-luminance auto-detect. */
  forceInvert?: boolean
  /** Skip the auto-trim step (e.g. user already cropped tight, no margins to remove). */
  skipTrim?: boolean
  /** Ignore inner contours and treat each outer subpath as a filled solid.
   * Useful for keychain-style cutouts where you want each LETTER cut through
   * as a solid shape, instead of just the thin OUTLINE of a letter.
   * Default: false (preserve letter counters faithfully). */
  ignoreHoles?: boolean
  /**
   * Extrusion mode:
   *  - `silhouette` (default): outer polygons minus their holes — the
   *    "ink" of the logo. Used by through_cut / engraved / embossed.
   *  - `channels_only`: extrude JUST the holes (the white space inside
   *    each outer polygon). Used for the `channels` treatment, which
   *    engraves the negative space inside each letter while leaving the
   *    actual strokes at plate level. Outer-most background space (outside
   *    every outer polygon) is never touched.
   */
  mode?: 'silhouette' | 'channels_only'
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
  const mode = opts.mode ?? 'silhouette'
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

  // Step 1b: produce a grayscale buffer for potrace.
  //
  // FAST PATH — PNG with an alpha channel: the designer already encoded
  // the ink/background mask perfectly via transparency. Use it directly.
  // Negate so opaque pixels (the logo strokes) become BLACK (potrace's
  // "ink") and transparent pixels (channels + background) become WHITE.
  // This sidesteps every threshold / contrast / gradient pitfall.
  //
  // COLOUR PATH — no usable alpha but the logo is coloured ink on an
  // achromatic background (white / black / a baked-in transparency
  // checkerboard). The HSV saturation channel IS the ink mask: achromatic
  // pixels have ~0 saturation and drop out no matter how light or dark they
  // are. This is what rescues a logo exported with the editor's transparency
  // grid flattened into opaque pixels.
  //
  // LUMA PATH — monochrome logo, no colour signal: flatten against white,
  // grayscale, normalize the histogram, light blur to kill JPEG halos,
  // optional manual binary cut via `opts.binaryThreshold`.
  //
  // Alpha is "useful" only if it actually varies — a fully-opaque PNG has
  // hasAlpha=true but the alpha channel is useless (all 255).
  let alphaIsUseful = false
  if (meta.hasAlpha) {
    const allStats = await sharp(opts.imageBuffer).stats()
    const alphaCh = allStats.channels[allStats.channels.length - 1]
    alphaIsUseful = !!alphaCh && alphaCh.min < 240
  }

  let grayscale: Buffer
  if (alphaIsUseful) {
    // Extract the alpha mask, negate (opaque → black ink). Trace it at the
    // image's native resolution — upscaling here just interpolates (no real
    // detail gained) and smudges edges, which potrace then traces with extra
    // wobble. Native res keeps the designer-authored mask crisp.
    grayscale = await sharp(opts.imageBuffer)
      .extract(rect)
      .extractChannel('alpha')
      .negate()
      .toBuffer()
  } else {
    // No usable alpha. Read raw RGB once and compute per-pixel HSV saturation.
    // Achromatic pixels (r≈g≈b) — white, black, every grey checkerboard
    // square — have saturation ≈ 0. A coloured logo's strokes have high
    // saturation. So if the image carries enough colour signal, the
    // saturation channel is a clean ink mask immune to the background.
    const { data, info } = await sharp(opts.imageBuffer)
      .extract(rect)
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const px = info.width * info.height
    const sat = Buffer.alloc(px)
    let colouredCount = 0
    for (let i = 0, p = 0; p < px; i += info.channels, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const s = mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 255)
      sat[p] = s
      if (s > COLOR_INK_SAT) colouredCount++
    }

    if (colouredCount / px >= COLOR_INK_FRACTION) {
      // COLOUR PATH: saturated pixels are ink → negate so ink is dark for
      // potrace. A light blur smooths JPEG chroma-block noise without
      // eroding thin strokes.
      let pipeline = sharp(sat, {
        raw: { width: info.width, height: info.height, channels: 1 },
      })
        .negate()
        .blur(0.5)
      if (opts.binaryThreshold !== undefined) {
        pipeline = pipeline.threshold(opts.binaryThreshold)
      }
      grayscale = await pipeline.png().toBuffer()
    } else {
      // LUMA PATH: monochrome logo — no colour to exploit.
      let pipeline = sharp(opts.imageBuffer)
        .extract(rect)
        .flatten({ background: '#ffffff' })
        .grayscale()
        .normalize()
        .blur(0.8)
      if (opts.binaryThreshold !== undefined) {
        pipeline = pipeline.threshold(opts.binaryThreshold)
      }
      grayscale = await pipeline.toBuffer()
    }
  }

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
  // Each subpath gets:
  //   - depth: how many other subpaths enclose its first vertex
  //   - isOuter: depth is even (depth 0 = outermost contour, 2 = nested outer)
  //   - parentIndex: the immediate enclosing subpath (smallest-area encloser)
  //     — set for EVERY subpath except depth-0 ones. Used by channels_only
  //     mode to find direct children of each hole.
  type SubpathInfo = { index: number; depth: number; isOuter: boolean; parentIndex: number | null; poly: Pt[] }
  const infos: SubpathInfo[] = subpaths.map((sp, i) => {
    const probe = sp[0]
    const enclosers: number[] = []
    for (let j = 0; j < subpaths.length; j++) {
      if (i === j) continue
      if (pointInPolygon(probe, subpaths[j])) enclosers.push(j)
    }
    const depth = enclosers.length
    const isOuter = depth % 2 === 0
    let parentIndex: number | null = null
    if (enclosers.length > 0) {
      let bestArea = Infinity
      for (const j of enclosers) {
        const area = Math.abs(signedArea(subpaths[j]))
        if (area < bestArea) {
          bestArea = area
          parentIndex = j
        }
      }
    }
    return { index: i, depth, isOuter, parentIndex, poly: sp }
  })

  // Build a map: outer index → its DIRECT hole polygons (immediate children
  // that are holes). Used for silhouette mode.
  const holesByOuter = new Map<number, Pt[][]>()
  for (const inf of infos) {
    if (!inf.isOuter && inf.parentIndex !== null && infos[inf.parentIndex].isOuter) {
      const list = holesByOuter.get(inf.parentIndex) ?? []
      list.push(inf.poly)
      holesByOuter.set(inf.parentIndex, list)
    }
  }
  // Build a map: hole index → direct child outers nested inside it. Used by
  // channels_only mode to subtract nested strokes from a parent hole so the
  // resulting carve region is just the channel (white) area.
  const outersByHole = new Map<number, Pt[][]>()
  for (const inf of infos) {
    if (inf.isOuter && inf.parentIndex !== null && !infos[inf.parentIndex].isOuter) {
      const list = outersByHole.get(inf.parentIndex) ?? []
      list.push(inf.poly)
      outersByHole.set(inf.parentIndex, list)
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

  // Step 5+6: extrude per outer polygon into its own geom3, then union.
  // Two modes:
  //   - silhouette (default): each outer MINUS its holes → the ink shape.
  //   - channels_only: each HOLE on its own → the negative space inside the
  //     letter outlines. Used by the `channels` treatment to engrave just
  //     the inner counters while leaving strokes at plate level.
  const extrudedPieces: ReturnType<typeof extrudeLinear>[] = []
  let droppedPieces = 0

  if (mode === 'channels_only') {

    // Per hole: extrude (hole MINUS any directly-nested outer strokes).
    // For a letter drawn with parallel strokes (depth 0 outer / 1 hole /
    // 2 outer / 3 hole nesting), this produces:
    //   - depth-1 hole − depth-2 outer = the channel between strokes
    //   - depth-3 hole (no nested outers) = the centre void
    // Both wind CCW for the subtract operands; JSCAD's 2D boolean treats
    // them as filled regions.
    for (const inf of infos) {
      if (inf.isOuter) continue
      try {
        const holePoly = primitives.polygon({ points: ensureWinding(inf.poly, true) })
        const nestedOuters = outersByHole.get(inf.index) ?? []
        let shape2D: ReturnType<typeof primitives.polygon> = holePoly
        if (nestedOuters.length > 0) {
          const nestedGeoms = nestedOuters.map((p) =>
            primitives.polygon({ points: ensureWinding(p, true) }),
          )
          shape2D = booleans.subtract(holePoly, ...nestedGeoms) as ReturnType<typeof primitives.polygon>
        }
        const piece = extrudeLinear({ height: 1 }, shape2D)
        extrudedPieces.push(piece)
      } catch (err) {
        droppedPieces++
        console.warn(`[logo-extrude] dropped channel piece #${inf.index}: ${(err as Error).message}`)
      }
    }
  } else for (const inf of infos) {
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
