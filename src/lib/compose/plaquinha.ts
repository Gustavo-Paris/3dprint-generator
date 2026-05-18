/**
 * Desk plaque composer (plaquinha de mesa) — vertical plate with logo cut
 * through, mounted on a flat foot. The plate tilts back ~15° so the logo
 * face is readable when sitting on a desk in front of the viewer.
 *
 * Geometry:
 *   - Plate (carries the logo): cuboid in XZ plane, thickness along Y
 *   - Foot: cuboid lying flat (XY plane), thickness along Z
 *   - Plate is rotated -15° around X (top leans away from viewer in +Y) and
 *     translated to sit at the BACK edge of the foot
 *   - Logo is cut through the plate before the tilt (CSG works in either
 *     order, but carving first keeps the cut perpendicular to the plate face)
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

export interface ComposePlaquinhaOptions {
  imageBuffer: Buffer
  /** Plate width (X) in mm. Default 80. */
  plateWidthMm?: number
  /** Plate height (Z, before tilt) in mm. Default 50. */
  plateHeightMm?: number
  /** Plate thickness (Y) in mm. Default 4. */
  plateDepthMm?: number
  /** Foot dimensions: width matches plate; depth in mm. Default 35. */
  footDepthMm?: number
  /** Foot thickness in mm. Default 4. */
  footThicknessMm?: number
  /** Backward tilt angle in degrees. Default 15. */
  tiltDeg?: number
  /** Logo fills this fraction of plate width. Default 0.8. */
  logoSizeRatio?: number
}

export interface ComposePlaquinhaResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    plateMm: { w: number; h: number; d: number }
    footMm: { w: number; d: number; t: number }
    tiltDeg: number
  }
}

export async function composePlaquinha(
  opts: ComposePlaquinhaOptions,
): Promise<ComposePlaquinhaResult> {
  const plateW = opts.plateWidthMm ?? 80
  const plateH = opts.plateHeightMm ?? 50
  const plateD = opts.plateDepthMm ?? 4
  const footD = opts.footDepthMm ?? 35
  const footT = opts.footThicknessMm ?? 4
  const tiltDeg = opts.tiltDeg ?? 15
  const tiltRad = (tiltDeg * Math.PI) / 180
  const logoSizeRatio = opts.logoSizeRatio ?? 0.8

  // Step 1: extrude logo as a slab thicker than the plate so the cut goes
  // fully through.
  const overshoot = 1
  const logoSlabDepth = plateD + overshoot * 2
  const targetLogoMax = plateW * logoSizeRatio
  const logo = await extrudeLogo({
    imageBuffer: opts.imageBuffer,
    targetMaxDim: targetLogoMax,
    depthMm: logoSlabDepth,
    ignoreHolesSmallerThan: 0.3,
  })
  const logoPositions = parseBinarySTL(logo.stl)

  // Step 2: build the plate centered at origin, vertical.
  //   X: [-plateW/2, +plateW/2]
  //   Y: [-plateD/2, +plateD/2]
  //   Z: [-plateH/2, +plateH/2]
  const plate = primitives.cuboid({
    size: [plateW, plateD, plateH],
    center: [0, 0, 0],
  })

  // Step 3: build logo geom3 (centered at origin, image plane in XZ, thickness
  // along Y — same convention as the keychain composer). Logo Y range:
  // [-logoSlabDepth/2, +logoSlabDepth/2] centered at 0, so it cuts fully
  // through the plate (which is Y ∈ [-plateD/2, +plateD/2]) with overshoot.
  type Vec3 = [number, number, number]
  const logoPolygons: Array<{ vertices: Vec3[] }> = []
  for (let i = 0; i < logoPositions.length; i += 9) {
    const verts: Vec3[] = []
    for (let v = 0; v < 3; v++) {
      const x = logoPositions[i + v * 3]
      const y = logoPositions[i + v * 3 + 1]
      const z = logoPositions[i + v * 3 + 2]
      verts.push([x, y, z])
    }
    logoPolygons.push({ vertices: verts })
  }
  const logoGeom3 = geometries.geom3.create(
    logoPolygons as unknown as Parameters<typeof geometries.geom3.create>[0],
  )

  // Step 4: plate with logo cut through.
  const carvedPlate = booleans.subtract(plate, logoGeom3)

  // Step 5: tilt the carved plate -tiltRad around X. After this:
  //   - Top of plate moves toward +Y (leans back from viewer)
  //   - Bottom of plate moves toward -Y (slightly forward)
  //
  // We also need the bottom of the tilted plate to sit on TOP of the foot.
  // After rotating -tiltRad around X axis (through origin), bottom-front
  // corner (originally at y=-plateD/2, z=-plateH/2) moves to:
  //   newY = y*cos + z*sin = -plateD/2 * cos(-tiltRad) + -plateH/2 * sin(-tiltRad)
  //        = -plateD/2 * cos + plateH/2 * sin
  //   newZ = -y*sin + z*cos = plateD/2 * sin - plateH/2 * cos
  //
  // Simpler: just translate the plate up so its lowest point ends up at the
  // foot's top surface (Z = footT/2 if foot is centered at z=0, or Z = footT
  // if foot's bottom is at z=0). I'll center everything at origin in the end
  // and let bbox handle the final placement.
  //
  // Strategy:
  //   1. rotate plate around X
  //   2. find new bbox of rotated plate
  //   3. translate plate up so its min Z aligns with foot's top
  const tiltedPlate = transforms.rotateX(-tiltRad, carvedPlate)

  // Compute the rotated plate's min Z (relative to origin)
  // After -tiltRad around X:
  //   The lowest point of the plate is one of its 8 corners. We sample all
  //   four bottom corners (z = -plateH/2) and pick min.
  const minZAfterRot = (() => {
    const cosA = Math.cos(-tiltRad)
    const sinA = Math.sin(-tiltRad)
    let m = Infinity
    for (const y of [-plateD / 2, plateD / 2]) {
      for (const z of [-plateH / 2, plateH / 2]) {
        const newZ = -y * sinA + z * cosA
        if (newZ < m) m = newZ
      }
    }
    return m
  })()

  // Step 6: build the foot. Width matches plate, lying flat.
  // Center the foot in Z at -footT/2 so its TOP is at z=0; then translate
  // the plate up so its bottom is also at z=0.
  const foot = primitives.cuboid({
    size: [plateW, footD, footT],
    center: [0, 0, -footT / 2],
  })

  // Translate the tilted plate UP so its lowest point is at z=0 (the top of the foot).
  const plateLift = -minZAfterRot
  const liftedPlate = transforms.translate([0, 0, plateLift], tiltedPlate)

  // Step 7: union plate + foot.
  const finalPiece = booleans.union(liftedPlate, foot)

  // Step 8: serialize.
  const finalPolys = geometries.geom3.toPolygons(finalPiece)
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

  // Compute final bbox
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  return {
    stl,
    meta: {
      bboxMm: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
      plateMm: { w: plateW, h: plateH, d: plateD },
      footMm: { w: plateW, d: footD, t: footT },
      tiltDeg,
    },
  }
}
