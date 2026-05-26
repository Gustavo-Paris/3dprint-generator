import type { BaseMesh } from '../types'

/** Recompute normals + bbox from positions. Used by ops that transform vertices. */
export function recomputeMeshDerived(
  partial: Omit<BaseMesh, 'normals' | 'bbox'> & { positions: Float32Array },
): BaseMesh {
  const positions = partial.positions
  const triangleCount = positions.length / 9
  const normals = new Float32Array(triangleCount * 3)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < triangleCount; i++) {
    const o = i * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len
    for (const x of [ax, bx, cx]) { if (x < minX) minX = x; if (x > maxX) maxX = x }
    for (const y of [ay, by, cy]) { if (y < minY) minY = y; if (y > maxY) maxY = y }
    for (const z of [az, bz, cz]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z }
  }
  return {
    positions, normals,
    extruders: partial.extruders,
    triangleCount,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}

/** Convert a BaseMesh into a JSCAD Geom3 (for boolean ops). */
export async function baseMeshToGeom3(mesh: BaseMesh) {
  const { geometries } = await import('@jscad/modeling')
  const polygons = []
  for (let i = 0; i < mesh.triangleCount; i++) {
    const o = i * 9
    polygons.push(geometries.poly3.create([
      [mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]],
      [mesh.positions[o + 3], mesh.positions[o + 4], mesh.positions[o + 5]],
      [mesh.positions[o + 6], mesh.positions[o + 7], mesh.positions[o + 8]],
    ]))
  }
  return geometries.geom3.create(polygons)
}

/** Convert a JSCAD Geom3 back to a BaseMesh. New geometry inherits the
 *  `defaultExtruder`; existing extruder labels are NOT preserved across
 *  boolean ops (JSCAD merges polygons opaquely). */
export async function geom3ToBaseMesh(
  geom: unknown,
  defaultExtruder: 'A' | 'B' = 'A',
): Promise<BaseMesh> {
  const { geometries } = await import('@jscad/modeling')
  const polys = geometries.geom3.toPolygons(geom as Parameters<typeof geometries.geom3.toPolygons>[0])
  const positions: number[] = []
  for (const p of polys) {
    const v = p.vertices
    for (let i = 1; i < v.length - 1; i++) positions.push(...v[0], ...v[i], ...v[i + 1])
  }
  const triangleCount = positions.length / 9
  return recomputeMeshDerived({
    positions: new Float32Array(positions),
    extruders: new Array(triangleCount).fill(defaultExtruder),
    triangleCount,
  } as Omit<BaseMesh, 'normals' | 'bbox'> & { positions: Float32Array })
}
