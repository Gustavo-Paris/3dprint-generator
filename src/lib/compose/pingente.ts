/**
 * Pendant composer — small thin disc with the user's logo cut through and a
 * tiny hole near the top edge for stringing on a chain/cord.
 *
 * Simpler than the medal: no separate hanging ring, just a hole drilled
 * through the disc itself.
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

export interface ComposePingenteOptions {
  imageBuffer: Buffer
  /** Pendant diameter in mm. Default 28. */
  diameterMm?: number
  /** Thickness in mm. Default 3. */
  thicknessMm?: number
  /** Cord-hole diameter in mm. Default 2.5 (fits typical chains). */
  cordHoleDiameter?: number
  /** Distance from the rim to the cord-hole center. Default 3mm. */
  cordHoleMargin?: number
  /** Fraction of the disc diameter that the logo fills. Default 0.7
   * (smaller than medal because the piece itself is smaller — more material
   * around the logo for strength). */
  logoSizeRatio?: number
}

export interface ComposePingenteResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    diameterMm: number
    thicknessMm: number
  }
}

export async function composePingente(
  opts: ComposePingenteOptions,
): Promise<ComposePingenteResult> {
  const diameter = opts.diameterMm ?? 28
  const thickness = opts.thicknessMm ?? 3
  const cordHoleD = opts.cordHoleDiameter ?? 2.5
  const cordHoleMargin = opts.cordHoleMargin ?? 3
  const logoSizeRatio = opts.logoSizeRatio ?? 0.7
  const targetLogoMax = diameter * logoSizeRatio

  // Step 1: extrude logo as a slab thicker than the disc so the subtract cuts
  // all the way through.
  const overshoot = 1
  const logoSlabDepth = thickness + overshoot * 2
  const logo = await extrudeLogo({
    imageBuffer: opts.imageBuffer,
    targetMaxDim: targetLogoMax,
    depthMm: logoSlabDepth,
    ignoreHolesSmallerThan: 0.05,
  })
  const logoPositions = parseBinarySTL(logo.stl)

  // Step 2: pendant disc.
  const disc = primitives.cylinder({
    radius: diameter / 2,
    height: thickness,
    segments: 80,
  })

  // Step 3: cord-hole punched near the top edge of the disc. Axis along Z so
  // the hole goes through both faces of the pendant (cord threads through).
  // Placed at +Y direction (same convention as the medal's ring).
  const cordHoleY = diameter / 2 - cordHoleMargin
  const cordHole = primitives.cylinder({
    radius: cordHoleD / 2,
    height: thickness + 1, // overshoot
    segments: 32,
    center: [0, cordHoleY, 0],
  })
  const discWithHole = booleans.subtract(disc, cordHole)

  // Step 4: rotate logo to lie flat on the disc + position centered in Z so it
  // cuts through. (x, y, z) → (x, z, -y); dz = 0 (centered).
  type Vec3 = [number, number, number]
  const logoPolygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < logoPositions.length; i += 9) {
    const verts: Vec3[] = []
    for (let v = 0; v < 3; v++) {
      const x = logoPositions[i + v * 3]
      const y = logoPositions[i + v * 3 + 1]
      const z = logoPositions[i + v * 3 + 2]
      verts.push([x, z, -y])
    }
    logoPolygons.push({ vertices: verts })
  }
  const logoGeom3 = geometries.geom3.create(
    logoPolygons as unknown as Parameters<typeof geometries.geom3.create>[0],
  )

  // Step 5: subtract logo from disc-with-hole → final pendant.
  const finalPendant = booleans.subtract(discWithHole, logoGeom3)

  // Step 6: serialize to STL.
  const finalPolys = geometries.geom3.toPolygons(finalPendant)
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
    },
  }
}
