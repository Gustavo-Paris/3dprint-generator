import type { BaseMesh, SemanticFace } from './types'

const MAX_FACES = 12
const NORMAL_TOLERANCE_DEG = 5
const COS_TOL = Math.cos((NORMAL_TOLERANCE_DEG * Math.PI) / 180)

/** Group triangles by normal similarity (no adjacency check — fast and
 *  good enough for CAD-like meshes; organic meshes get over-merged but
 *  that's fine, the LLM still has previews to disambiguate). */
export function segmentFaces(mesh: BaseMesh): SemanticFace[] {
  const groups: Array<{ normalSum: [number, number, number]; tris: number[] }> = []

  for (let i = 0; i < mesh.triangleCount; i++) {
    const nx = mesh.normals[i * 3]
    const ny = mesh.normals[i * 3 + 1]
    const nz = mesh.normals[i * 3 + 2]

    let placed = false
    for (const g of groups) {
      const gx = g.normalSum[0] / g.tris.length
      const gy = g.normalSum[1] / g.tris.length
      const gz = g.normalSum[2] / g.tris.length
      const glen = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
      const dot = (nx * gx + ny * gy + nz * gz) / glen
      if (dot >= COS_TOL) {
        g.tris.push(i)
        g.normalSum[0] += nx
        g.normalSum[1] += ny
        g.normalSum[2] += nz
        placed = true
        break
      }
    }
    if (!placed) {
      groups.push({ normalSum: [nx, ny, nz], tris: [i] })
    }
  }

  const faces: SemanticFace[] = groups.map((g, id) => {
    // Average normal (unit)
    const sx = g.normalSum[0], sy = g.normalSum[1], sz = g.normalSum[2]
    const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
    const normal: [number, number, number] = [sx / slen, sy / slen, sz / slen]

    // Area + centroid (area-weighted)
    let area = 0
    let cx = 0, cy = 0, cz = 0
    for (const ti of g.tris) {
      const o = ti * 9
      const ax = mesh.positions[o], ay = mesh.positions[o + 1], az = mesh.positions[o + 2]
      const bx = mesh.positions[o + 3], by = mesh.positions[o + 4], bz = mesh.positions[o + 5]
      const ccx = mesh.positions[o + 6], ccy = mesh.positions[o + 7], ccz = mesh.positions[o + 8]
      const ux = bx - ax, uy = by - ay, uz = bz - az
      const vx = ccx - ax, vy = ccy - ay, vz = ccz - az
      const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
      const triArea = 0.5 * Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2)
      const triCentroid = [(ax + bx + ccx) / 3, (ay + by + ccy) / 3, (az + bz + ccz) / 3]
      area += triArea
      cx += triCentroid[0] * triArea
      cy += triCentroid[1] * triArea
      cz += triCentroid[2] * triArea
    }
    cx /= area; cy /= area; cz /= area

    // In-plane 2D bbox
    const tangent = pickTangent(normal)
    const bitangent: [number, number, number] = [
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ]
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const ti of g.tris) {
      const o = ti * 9
      for (let k = 0; k < 3; k++) {
        const px = mesh.positions[o + k * 3] - cx
        const py = mesh.positions[o + k * 3 + 1] - cy
        const pz = mesh.positions[o + k * 3 + 2] - cz
        const u = px * tangent[0] + py * tangent[1] + pz * tangent[2]
        const v = px * bitangent[0] + py * bitangent[1] + pz * bitangent[2]
        if (u < u0) u0 = u; if (u > u1) u1 = u
        if (v < v0) v0 = v; if (v > v1) v1 = v
      }
    }

    return {
      id,
      normal,
      centroid: [cx, cy, cz],
      areaMm2: area,
      triangleIndices: g.tris,
      bboxOnPlane: { min: [u0, v0], max: [u1, v1] },
    }
  })

  // Sort by area desc, take top-12, renumber ids
  faces.sort((a, b) => b.areaMm2 - a.areaMm2)
  return faces.slice(0, MAX_FACES).map((f, i) => ({ ...f, id: i }))
}

function pickTangent(normal: [number, number, number]): [number, number, number] {
  // Pick the world axis least aligned with the normal, project to tangent plane.
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const tx = seed[0] - dot * normal[0]
  const ty = seed[1] - dot * normal[1]
  const tz = seed[2] - dot * normal[2]
  const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  return [tx / len, ty / len, tz / len]
}
