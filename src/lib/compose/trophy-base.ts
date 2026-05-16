import * as jscad from '@jscad/modeling'
import { serializeBinarySTL } from '@/lib/stl/serialize'

const { primitives, booleans, geometries } = jscad

export type BaseSpec = {
  /** Top platform diameter in mm — should be ~1.2x the logo's max XY dim */
  topDiameter: number
  /** Bottom diameter in mm — typically 1.4x the top for a stable taper */
  bottomDiameter: number
  /** Total height in mm */
  height: number
}

/**
 * Build a parametric trophy base: wide bottom cylinder + tapered middle + top platform.
 * The mesh's local origin is at the bottom center; "up" is +Z.
 * Returns watertight binary STL bytes.
 */
export function buildTrophyBase(spec: BaseSpec): Uint8Array {
  const seg = 64
  const bottomH = spec.height * 0.3
  const middleH = spec.height * 0.5
  const topH = spec.height * 0.2

  const bottom = primitives.cylinder({
    radius: spec.bottomDiameter / 2,
    height: bottomH,
    segments: seg,
    center: [0, 0, bottomH / 2],
  })
  const middle = primitives.cylinderElliptic({
    startRadius: [spec.bottomDiameter / 2, spec.bottomDiameter / 2],
    endRadius: [spec.topDiameter / 2, spec.topDiameter / 2],
    height: middleH,
    segments: seg,
    center: [0, 0, bottomH + middleH / 2],
  })
  const top = primitives.cylinder({
    radius: spec.topDiameter / 2,
    height: topH,
    segments: seg,
    center: [0, 0, bottomH + middleH + topH / 2],
  })

  const merged = booleans.union(bottom, middle, top)

  // Triangulate
  const { toPolygons } = geometries.geom3
  const polygons = toPolygons(merged as Parameters<typeof toPolygons>[0])
  const positions: number[] = []
  for (const poly of polygons) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      positions.push(...verts[0], ...verts[i], ...verts[i + 1])
    }
  }
  return serializeBinarySTL(positions)
}
