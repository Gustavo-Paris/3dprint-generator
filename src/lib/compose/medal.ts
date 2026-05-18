/**
 * Medal composer — round disc with logo engraved on the top face, plus a
 * small annular hanging loop attached to one edge for stringing onto a
 * ribbon/cord.
 *
 * Deterministic. No Meshy. ~1s. Clean output every time.
 *
 * Pipeline:
 *   1. Disc cylinder (axis along Z, lies flat).
 *   2. Logo slab extruded thin, rotated to lie flat, positioned so it carves
 *      INTO the top face (engraved, not through-hole — same approach as
 *      coaster).
 *   3. Annular hanging ring placed at the +Y edge (axis perpendicular to disc
 *      face so the cord can pass through), unioned with the disc body.
 *   4. Subtract the logo geom from the combined disc+ring → final mesh.
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

export interface ComposeMedalOptions {
  imageBuffer: Buffer
  /** Medal diameter in mm. Default 60. */
  diameterMm?: number
  /** Medal thickness in mm. Default 4. */
  thicknessMm?: number
  /** How deep the logo is engraved into the top face. Default 1.5mm. */
  engraveDepthMm?: number
  /** Diameter of the hanging hole. Default 5mm. */
  holeDiameter?: number
  /** Outer diameter of the hanging ring. Default holeDiameter * 2.4. */
  ringOuterDiameter?: number
  /** Fraction of the disc diameter that the logo fills (0..1). Default 0.8. */
  logoSizeRatio?: number
}

export interface ComposeMedalResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    diameterMm: number
    thicknessMm: number
  }
}

export async function composeMedal(
  opts: ComposeMedalOptions,
): Promise<ComposeMedalResult> {
  const diameter = opts.diameterMm ?? 60
  const thickness = opts.thicknessMm ?? 5
  const engraveDepth = opts.engraveDepthMm ?? 2.5
  const holeD = opts.holeDiameter ?? 5
  const ringOuterD = opts.ringOuterDiameter ?? holeD * 2.4
  const logoSizeRatio = opts.logoSizeRatio ?? 0.8
  const targetLogoMax = diameter * logoSizeRatio

  // Step 1: extrude the logo slab THICKER than the disc so the boolean
  // subtract cuts all the way through from top face to bottom face.
  // The "engraveDepth" param is preserved for API compat but ignored now —
  // medal cuts through, like a stencil.
  void engraveDepth
  const overshoot = 1
  const logoSlabDepth = thickness + overshoot * 2
  const logo = await extrudeLogo({
    imageBuffer: opts.imageBuffer,
    targetMaxDim: targetLogoMax,
    depthMm: logoSlabDepth,
    // Aggressive detail preservation for medals: keep almost all holes,
    // only fill tiny noise (< 5% of outer). This preserves things like
    // the brain/chip icons inside the ToStudy balloons, or the counters
    // of text letters, so the medal reads as a proper stencil with all
    // logo features visible through.
    ignoreHolesSmallerThan: 0.05,
  })
  const logoPositions = parseBinarySTL(logo.stl)

  // Step 2: disc cylinder centered at origin, axis along Z.
  const disc = primitives.cylinder({
    radius: diameter / 2,
    height: thickness,
    segments: 96,
  })

  // Step 3: hanging ring (annulus). Placed at +Y edge of disc, axis along Z
  // so the cord-hole goes from top face to bottom face of the medal (same
  // direction as you'd thread a ribbon through a real medal).
  //
  // Ring center: just outside the disc rim, but with a small overlap so the
  // ring is fused to the disc body (no gap, no thin connection).
  const ringCenterY = diameter / 2 + ringOuterD / 2 - ringOuterD * 0.25 // 25% overlap
  const ringOuter = primitives.cylinder({
    radius: ringOuterD / 2,
    height: thickness,
    segments: 64,
    center: [0, ringCenterY, 0],
  })
  const ringHole = primitives.cylinder({
    radius: holeD / 2,
    height: thickness + 1, // overshoot for clean cut
    segments: 48,
    center: [0, ringCenterY, 0],
  })
  const ring = booleans.subtract(ringOuter, ringHole)

  const discWithRing = booleans.union(disc, ring)

  // Step 4: rotate + translate the logo slab to lie on the disc's top face.
  //
  // After extrudeLogo, logo's image plane is XZ (vertical), Y is thickness.
  // We need image plane parallel to XY (horizontal top face of disc).
  // Rotate -90° around X: (x, y, z) → (x, z, -y).
  // After rotation: image-Y (was mesh Z) → mesh +Y (lies flat on disc face).
  // Extrusion thickness (was mesh Y) → mesh -Z (now vertical, slab extends
  // downward).
  //
  // Translate so the logo slab is CENTERED in Z on the disc — extends from
  // -(thickness + overshoot)/2 to +(thickness + overshoot)/2, cutting through
  // the full disc thickness with overshoot on each face for clean booleans.
  const dz = 0
  type Vec3 = [number, number, number]
  const logoPolygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < logoPositions.length; i += 9) {
    const verts: Vec3[] = []
    for (let v = 0; v < 3; v++) {
      const x = logoPositions[i + v * 3]
      const y = logoPositions[i + v * 3 + 1]
      const z = logoPositions[i + v * 3 + 2]
      // Rotate logo -90° around X so its image plane lies flat on the disc
      // top. (x, y, z) → (x, z, -y + dz). Determinant +1 (proper rotation),
      // so triangle winding is preserved and boolean subtract works correctly.
      //
      // The viewer's own rotation may make the in-viewer orientation look
      // upside-down depending on camera angle, but the underlying STL
      // geometry is correct — slicer/printer orient as needed.
      verts.push([x, z, -y + dz])
    }
    logoPolygons.push({ vertices: verts })
  }
  const logoGeom3 = geometries.geom3.create(
    logoPolygons as unknown as Parameters<typeof geometries.geom3.create>[0],
  )

  // Step 5: subtract logo from disc+ring → engraved medal.
  const finalMedal = booleans.subtract(discWithRing, logoGeom3)

  // Step 6: serialize to STL.
  const finalPolys = geometries.geom3.toPolygons(finalMedal)
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
      bboxMm: { x: diameter, y: diameter + ringOuterD * 0.75, z: thickness },
      diameterMm: diameter,
      thicknessMm: thickness,
    },
  }
  // transforms imported for future variants (e.g. ring axis change)
  void transforms
}
