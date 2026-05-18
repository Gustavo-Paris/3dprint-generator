/**
 * Keychain composer — DEAD SIMPLE version.
 *
 * Output: rectangular plate (60×50×4 mm by default) with the user's logo
 * raised as a thin relief on the front face + a circular through-hole near
 * the top for a keyring.
 *
 * Pipeline:
 *   1. Plate (JSCAD cuboid) minus a cylindrical hole near the top.
 *   2. Logo extruded thin (1mm slab) via the existing logo-extrude pipeline.
 *   3. Translate the logo slab forward so it half-overlaps the plate's front
 *      face and half sticks out as visible relief.
 *   4. Concatenate the plate-with-hole triangles and the logo triangles → STL.
 *
 * No Meshy. No vision LLM. Purely deterministic. Takes ~100ms.
 */
import * as jscadNs from '@jscad/modeling'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

type JscadShape = {
  primitives: typeof import('@jscad/modeling').primitives
  booleans: typeof import('@jscad/modeling').booleans
  transforms: typeof import('@jscad/modeling').transforms
  geometries: typeof import('@jscad/modeling').geometries
}
const jscad: JscadShape =
  ((jscadNs as unknown as { default?: JscadShape }).default ??
    (jscadNs as unknown as JscadShape))
const { primitives, booleans, transforms, geometries } = jscad

export interface ComposeKeychainOptions {
  imageBuffer: Buffer
  plateWidthMm?: number
  plateHeightMm?: number
  plateDepthMm?: number
  /** Largest dim of the logo relief, in mm. Should be smaller than the plate. */
  logoMaxMm?: number
  /** How thick the logo slab is (= how much it sticks out + how much overlaps). */
  reliefDepthMm?: number
  /** Diameter of the keyring hole. */
  holeDiameter?: number
  /** Distance from the top edge to the hole center. */
  holeMarginMm?: number
  /** Fraction-based logo size hint. If set, overrides default logoMaxMm calc. */
  logoSizeRatio?: number
}

export interface ComposeKeychainResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    plateMm: { w: number; h: number; d: number }
    logoBboxMm: { x: number; y: number; z: number }
  }
}

export async function composeKeychain(
  opts: ComposeKeychainOptions,
): Promise<ComposeKeychainResult> {
  const plateD = opts.plateDepthMm ?? 4
  const holeD = opts.holeDiameter ?? 4
  const sideMargin = 5  // mm of plate around the logo on left/right/bottom
  const topZone = 11    // mm reserved at the top of the plate for the keyring hole

  // The logo slab is extruded THICKER than the plate so that when we subtract
  // it from the plate, the cut passes ALL THE WAY THROUGH from front to back —
  // a true "vazado" (see-through). overshoot on both sides ensures the
  // boolean leaves no paper-thin caps.
  const cutoutOvershoot = 1
  const logoSlabDepth = plateD + cutoutOvershoot * 2

  // Step 1: extrude the logo slab.
  // logoMaxMm (absolute mm) wins; else if sizeRatio is given, map it onto
  // a ~25mm..50mm range for the logo's max dim; else fall back to 35mm.
  const targetLogoMax =
    opts.logoMaxMm ??
    (opts.logoSizeRatio !== undefined ? 25 + opts.logoSizeRatio * 30 : 35)
  const logo = await extrudeLogo({
    imageBuffer: opts.imageBuffer,
    targetMaxDim: targetLogoMax,
    depthMm: logoSlabDepth,
    // Fill small letter counters (interior of O, P, A in normal text) so
    // they cut as solid shapes. Preserve LARGE counters of outlined designs
    // (PG monogram drawn as contours) so they don't get filled into a giant
    // rectangle. 0.4 = "if the hole is at least 40% the size of its outer,
    // it's a real design counter — keep it".
    ignoreHolesSmallerThan: 0.3,
  })
  const logoPositions = parseBinarySTL(logo.stl)

  let lMinX = Infinity, lMaxX = -Infinity
  let lMinY = Infinity, lMaxY = -Infinity
  let lMinZ = Infinity, lMaxZ = -Infinity
  for (let i = 0; i < logoPositions.length; i += 3) {
    const x = logoPositions[i], y = logoPositions[i + 1], z = logoPositions[i + 2]
    if (x < lMinX) lMinX = x; if (x > lMaxX) lMaxX = x
    if (y < lMinY) lMinY = y; if (y > lMaxY) lMaxY = y
    if (z < lMinZ) lMinZ = z; if (z > lMaxZ) lMaxZ = z
  }
  const logoW = lMaxX - lMinX
  const logoH = lMaxZ - lMinZ

  // Step 2: plate fits the logo aspect with margins. Override via opts if
  // caller wants fixed dimensions.
  const plateW = opts.plateWidthMm ?? Math.max(30, logoW + sideMargin * 2)
  const plateH = opts.plateHeightMm ?? Math.max(40, logoH + topZone + sideMargin)

  // Step 3: plate cuboid centered at origin. Frame: X=width, Y=depth, Z=height.
  const plate = primitives.cuboid({
    size: [plateW, plateD, plateH],
    center: [0, 0, 0],
  })

  // Step 4: hole at the top of the plate, axis along Y (front to back).
  const holeCenterZ = plateH / 2 - topZone / 2
  const hole = transforms.translate(
    [0, 0, holeCenterZ],
    transforms.rotateX(
      Math.PI / 2,
      primitives.cylinder({
        radius: holeD / 2,
        height: plateD + 1, // overshoot for clean cut
        segments: 48,
      }),
    ),
  )

  const plateWithHole = booleans.subtract(plate, hole)

  // Step 5: center the logo slab on the plate's Y axis so it punches through
  // from front to back. The slab is `plateD + 2` thick → 1mm overshoot on each
  // face after centering, which guarantees the boolean subtract leaves clean
  // through-holes (no paper-thin caps).
  const dy = 0
  const dx = -((lMinX + lMaxX) / 2)
  const logoZoneCenterZ = (-plateH / 2 + sideMargin + (plateH / 2 - topZone)) / 2
  const dz = logoZoneCenterZ - (lMinZ + lMaxZ) / 2

  // Step 6: reconstruct the logo as a JSCAD geom3 from the STL triangles, with
  // the translation baked in. Each STL triangle → one polygon. Vertex order
  // is preserved, so winding (outward normals) stays correct.
  type Vec3 = [number, number, number]
  const logoPolygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < logoPositions.length; i += 9) {
    const v0: Vec3 = [
      logoPositions[i] + dx,
      logoPositions[i + 1] + dy,
      logoPositions[i + 2] + dz,
    ]
    const v1: Vec3 = [
      logoPositions[i + 3] + dx,
      logoPositions[i + 4] + dy,
      logoPositions[i + 5] + dz,
    ]
    const v2: Vec3 = [
      logoPositions[i + 6] + dx,
      logoPositions[i + 7] + dy,
      logoPositions[i + 8] + dz,
    ]
    logoPolygons.push({ vertices: [v0, v1, v2] })
  }
  const logoGeom3 = geometries.geom3.create(
    logoPolygons as unknown as Parameters<typeof geometries.geom3.create>[0],
  )

  // Step 7: subtract the logo from the plate → carved keychain.
  const finalKeychain = booleans.subtract(plateWithHole, logoGeom3)

  // Step 8: serialize final geom3 to triangle positions.
  const finalPolys = geometries.geom3.toPolygons(finalKeychain)
  const out: number[] = []
  for (const poly of finalPolys) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        out.push(v[0], v[1], v[2])
      }
    }
  }

  const stl = serializeBinarySTL(out)

  return {
    stl,
    meta: {
      bboxMm: { x: plateW, y: plateD, z: plateH },
      plateMm: { w: plateW, h: plateH, d: plateD },
      logoBboxMm: { x: logoW, y: plateD, z: logoH },
    },
  }
}
