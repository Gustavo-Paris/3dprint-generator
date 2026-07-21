import type { BaseMesh } from '../types'
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'
import type Mat4 from '@jscad/modeling/src/maths/mat4/type'

type Transforms = typeof import('@jscad/modeling').transforms

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

/** Resolve @jscad/modeling regardless of CJS-vs-ESM default-export shape.
 *  Mirrors the workaround in src/lib/design/generate.ts. */
export async function loadJscad() {
  const ns = (await import('@jscad/modeling')) as unknown as {
    default?: typeof import('@jscad/modeling')
  } & typeof import('@jscad/modeling')
  return ns.default ?? ns
}

/** Convert a BaseMesh into a JSCAD Geom3 (for boolean ops). */
export async function baseMeshToGeom3(mesh: BaseMesh) {
  const { geometries } = await loadJscad()
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
  const { geometries } = await loadJscad()
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

/** Build an orthonormal in-plane frame (tangent, bitangent) for a unit normal.
 *  Used to place geometry at a face centroid + (u,v) in-plane offset. */
export function makeFrame(normal: [number, number, number]) {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const tx = seed[0] - dot * normal[0]
  const ty = seed[1] - dot * normal[1]
  const tz = seed[2] - dot * normal[2]
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  const tangent: [number, number, number] = [tx / tl, ty / tl, tz / tl]
  const bitangent: [number, number, number] = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ]
  return { tangent, bitangent }
}

/** Unit-length copy of a 3-vector (falls back to +Z if zero). */
function unit3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * Column-major mat4 that rotates +Z onto `normal` (unit). Identity / 180°
 * around X for the degenerate cases — same contract as mat4.fromVectorRotation.
 */
export function mat4AlignZToNormal(normal: [number, number, number]): Mat4 {
  const n = unit3(normal)
  const dot = Math.max(-1, Math.min(1, n[2]))
  if (dot > 0.9999) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }
  if (dot < -0.9999) {
    // 180° about X: (x,y,z) → (x,-y,-z)
    return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
  }
  // axis = Z × n = [-ny, nx, 0]
  const alen = Math.hypot(-n[1], n[0]) || 1
  const ux = -n[1] / alen
  const uy = n[0] / alen
  const uz = 0
  const angle = Math.acos(dot)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  // Rodrigues, column-major (OpenGL / JSCAD mat4 layout)
  return [
    t * ux * ux + c, t * ux * uy + s * uz, t * ux * uz - s * uy, 0,
    t * ux * uy - s * uz, t * uy * uy + c, t * uy * uz + s * ux, 0,
    t * ux * uz + s * uy, t * uy * uz - s * ux, t * uz * uz + c, 0,
    0, 0, 0, 1,
  ]
}

/**
 * Rotate a geom built along +Z so its axis aligns with `normal`.
 *
 * Uses a full axis-angle rotation. The previous rotateX-OR-rotateY shortcut
 * was wrong for any normal with both nx and ny nonzero — logos on curved /
 * diagonal surfaces landed skewed or floating off the surface.
 */
export function orientAlongNormal(
  geom: Geom3,
  normal: [number, number, number],
  transforms: Transforms,
): Geom3 {
  const n = unit3(normal)
  if (n[2] > 0.9999) return geom
  if (n[2] < -0.9999) return transforms.rotateX(Math.PI, geom) as Geom3
  return transforms.transform(mat4AlignZToNormal(n), geom) as Geom3
}
