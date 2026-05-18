/**
 * Coaster composer — round disc with the user's logo engraved on the top face.
 *
 * Key difference from the keychain: the logo is DEBOSSED (carved into the
 * surface), NOT a through-hole. A coaster needs to stop liquid, so the disc
 * must remain solid underneath the engraving.
 *
 * Pipeline:
 *   1. Disc cylinder (axis along Z, lies flat on the table).
 *   2. Logo slab extruded thin via the existing logo-extrude pipeline.
 *   3. Rotate the logo 90° around X so it lies flat on the disc's top face
 *      (image plane → XY, thickness → Z).
 *   4. Translate so the logo's top surface is slightly above the disc top
 *      (overshoot for clean boolean) and the bottom sits inside the disc.
 *   5. Subtract the logo solid from the disc → engraved/debossed top face.
 */
import * as jscadNs from '@jscad/modeling'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

type JscadShape = {
  primitives: typeof import('@jscad/modeling').primitives
  booleans: typeof import('@jscad/modeling').booleans
  geometries: typeof import('@jscad/modeling').geometries
}
const jscad: JscadShape =
  ((jscadNs as unknown as { default?: JscadShape }).default ??
    (jscadNs as unknown as JscadShape))
const { primitives, booleans, geometries } = jscad

export interface ComposeCoasterOptions {
  imageBuffer: Buffer
  /** Coaster diameter in mm. Default 90 (standard mug coaster). */
  diameterMm?: number
  /** Coaster thickness in mm. Default 5. */
  thicknessMm?: number
  /** How deep the logo is engraved into the top face. Default 1.5mm. */
  engraveDepthMm?: number
  /** Largest dim of the logo on the coaster face. Default 70% of diameter. */
  logoMaxMm?: number
  /** Fraction of disc diameter for the logo. Overrides logoMaxMm default. */
  logoSizeRatio?: number
}

export interface ComposeCoasterResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    diameterMm: number
    thicknessMm: number
    engraveDepthMm: number
    logoBboxMm: { x: number; y: number; z: number }
  }
}

export async function composeCoaster(
  opts: ComposeCoasterOptions,
): Promise<ComposeCoasterResult> {
  const diameter = opts.diameterMm ?? 90
  const thickness = opts.thicknessMm ?? 5
  const engraveDepth = opts.engraveDepthMm ?? 2
  const targetLogoMax =
    opts.logoMaxMm ?? diameter * (opts.logoSizeRatio ?? 0.7)

  // The logo slab is extruded slightly thicker than the engraving depth so
  // the boolean subtract leaves no paper-thin film on the top surface.
  const overshoot = 0.2
  const logoSlabDepth = engraveDepth + overshoot

  // Step 1: extrude the logo. Letters treated as solid silhouettes
  // (ignoreHoles), same logic as the keychain — engrave the LETTER, not just
  // its outline.
  const logo = await extrudeLogo({
    imageBuffer: opts.imageBuffer,
    targetMaxDim: targetLogoMax,
    depthMm: logoSlabDepth,
    // Fill small counters (interior of filled letters like P, O, A) so they
    // engrave as solid shapes. Preserve LARGE counters — that's the negative
    // space inside outlined designs (PG monogram drawn as contours) — so
    // those engrave as their actual outline shape instead of filling the
    // whole bbox.
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

  // Step 2: disc cylinder centered at origin, axis along Z (lies flat).
  const disc = primitives.cylinder({
    radius: diameter / 2,
    height: thickness,
    segments: 96,
  })

  // Step 3 + 4: rotate the logo -90° around X (image plane vertical → horizontal)
  // AND translate so the top of the logo sits slightly above the disc's top face.
  //
  // rotateX(-π/2): (x, y, z) → (x, z, -y)
  //   - image-X stays in X
  //   - image-Y (image vertical, range [-logoH/2, +logoH/2] in mesh Z) → +Y
  //     image-top stays at the +Y side
  //   - extrusion thickness (range [-logoSlabDepth/2, +logoSlabDepth/2] in mesh Y)
  //     → -Z, becomes the new vertical thickness
  //
  // Why -π/2 (not +π/2): with +π/2 image-top ended up at world +Z (toward
  // viewer), which in the default camera-from-+X+Y+Z view shows up at the
  // BOTTOM of the screen — upside-down to the eye. With -π/2 image-top maps
  // to world -Z (back of scene), appearing at the TOP of the screen — reads
  // right-side up.
  const dz = thickness / 2 + overshoot - logoSlabDepth / 2

  type Vec3 = [number, number, number]
  const logoPolygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < logoPositions.length; i += 9) {
    const verts: Vec3[] = []
    for (let v = 0; v < 3; v++) {
      const x = logoPositions[i + v * 3]
      const y = logoPositions[i + v * 3 + 1]
      const z = logoPositions[i + v * 3 + 2]
      // rotate (x,y,z) → (x, z, -y) + translate in Z by dz.
      verts.push([x, z, -y + dz])
    }
    logoPolygons.push({ vertices: verts })
  }
  const logoGeom3 = geometries.geom3.create(
    logoPolygons as unknown as Parameters<typeof geometries.geom3.create>[0],
  )

  // Step 5: subtract logo from disc → engraved coaster.
  const finalCoaster = booleans.subtract(disc, logoGeom3)

  // Step 6: serialize to STL triangles.
  const finalPolys = geometries.geom3.toPolygons(finalCoaster)
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
      bboxMm: { x: diameter, y: diameter, z: thickness },
      diameterMm: diameter,
      thicknessMm: thickness,
      engraveDepthMm: engraveDepth,
      logoBboxMm: { x: logoW, y: logoH, z: engraveDepth },
    },
  }
}
