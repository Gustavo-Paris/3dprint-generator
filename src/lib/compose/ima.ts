/**
 * Fridge magnet composer — round disc with the user's logo ENGRAVED (not cut
 * through) on the front face, and a cylindrical cavity on the BACK face sized
 * to receive a stock N52 neodymium magnet (10×2mm by default).
 *
 * Key difference from coaster/medal:
 *  - Logo is engraved (debossed), NOT a through-hole — the disc must remain
 *    solid so the fridge magnet stays glued.
 *  - Second subtract on the back face for the magnet cavity.
 *
 * Safety check enforced via math: engrave_depth + cavity_depth + min_wall ≤
 * thickness. With defaults (1.5 + 2 + 0.5 = 4mm = thickness) this is exactly
 * at the limit — adjust if user overrides.
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

export interface ComposeImaOptions {
  imageBuffer: Buffer
  /** Magnet plate diameter in mm. Default 50. */
  diameterMm?: number
  /** Total thickness in mm. Default 4. */
  thicknessMm?: number
  /** Engraving depth into the front face. Default 1.5mm. */
  engraveDepthMm?: number
  /** Diameter of the back cavity (= the neodymium magnet's diameter). Default 10mm. */
  magnetDiameter?: number
  /** Depth of the back cavity (= the magnet's thickness). Default 2mm. */
  magnetDepth?: number
  /** Logo fills this fraction of disc diameter. Default 0.7. */
  logoSizeRatio?: number
}

export interface ComposeImaResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    diameterMm: number
    thicknessMm: number
    remainingWallMm: number
  }
}

export async function composeIma(opts: ComposeImaOptions): Promise<ComposeImaResult> {
  const diameter = opts.diameterMm ?? 50
  const thickness = opts.thicknessMm ?? 4
  const engraveDepth = opts.engraveDepthMm ?? 1.5
  const magnetD = opts.magnetDiameter ?? 10
  const magnetH = opts.magnetDepth ?? 2
  const logoSizeRatio = opts.logoSizeRatio ?? 0.7

  // Sanity check: enough material between engraving and magnet cavity?
  const remainingWall = thickness - engraveDepth - magnetH
  if (remainingWall < 0.4) {
    throw new Error(
      `Ímã wall too thin: ${remainingWall.toFixed(2)}mm. Need at least 0.4mm between ` +
        `logo engraving and magnet cavity. Increase thicknessMm or reduce engraveDepthMm/magnetDepth.`,
    )
  }

  const targetLogoMax = diameter * logoSizeRatio

  // Step 1: extrude logo slab. Just thicker than engraveDepth so the subtract
  // is clean on the front face.
  const overshoot = 0.2
  const logoSlabDepth = engraveDepth + overshoot
  const logo = await extrudeLogo({
    imageBuffer: opts.imageBuffer,
    targetMaxDim: targetLogoMax,
    depthMm: logoSlabDepth,
    ignoreHolesSmallerThan: 0.3,
  })
  const logoPositions = parseBinarySTL(logo.stl)

  // Step 2: disc.
  const disc = primitives.cylinder({
    radius: diameter / 2,
    height: thickness,
    segments: 96,
  })

  // Step 3: rotate logo to lie flat on the disc's top face and position so it
  // engraves DOWN into the top face by engraveDepth. Same approach as coaster.
  const dzLogo = thickness / 2 + overshoot - logoSlabDepth / 2
  type Vec3 = [number, number, number]
  const logoPolygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < logoPositions.length; i += 9) {
    const verts: Vec3[] = []
    for (let v = 0; v < 3; v++) {
      const x = logoPositions[i + v * 3]
      const y = logoPositions[i + v * 3 + 1]
      const z = logoPositions[i + v * 3 + 2]
      // (x, y, z) → (x, z, -y + dz): logo lies flat, extends DOWN from top
      verts.push([x, z, -y + dzLogo])
    }
    logoPolygons.push({ vertices: verts })
  }
  const logoGeom3 = geometries.geom3.create(
    logoPolygons as unknown as Parameters<typeof geometries.geom3.create>[0],
  )

  // Step 4: magnet cavity on the BACK face. Cylinder along Z, positioned so it
  // extends from the bottom face (-thickness/2) UPWARD by magnetH.
  // Cavity center Z = -thickness/2 + magnetH/2 - overshoot/2 (overshoot
  // outside the disc for a clean cut).
  const magnetCavityOvershoot = 0.2
  const magnetCavityCenterZ =
    -thickness / 2 + magnetH / 2 - magnetCavityOvershoot / 2
  const magnetCavity = primitives.cylinder({
    radius: magnetD / 2,
    height: magnetH + magnetCavityOvershoot,
    segments: 48,
    center: [0, 0, magnetCavityCenterZ],
  })

  // Step 5: disc minus logo (engraving) minus magnet cavity (back).
  const finalIma = booleans.subtract(disc, logoGeom3, magnetCavity)

  // Step 6: serialize.
  const finalPolys = geometries.geom3.toPolygons(finalIma)
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
      remainingWallMm: remainingWall,
    },
  }
}
