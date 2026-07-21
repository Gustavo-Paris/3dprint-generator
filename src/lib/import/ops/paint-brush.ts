/**
 * paint_brush — click-to-paint multi-colour on imported meshes.
 *
 * Modes:
 *  - radius: sphere brush around the click
 *  - fill:   paint-bucket flood-fill of the surface region bounded by sharp
 *            feature edges (ridges/grooves). Built only on triangles near the
 *            click so large sculpts (1M+ tris) stay interactive.
 */
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'

type PaintBrushParams = Extract<Op, { op: 'paint_brush' }>

function triCentroid(positions: Float32Array, tri: number): [number, number, number] {
  const o = tri * 9
  return [
    (positions[o] + positions[o + 3] + positions[o + 6]) / 3,
    (positions[o + 1] + positions[o + 4] + positions[o + 7]) / 3,
    (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3,
  ]
}

function q(v: number, inv = 40): number {
  return Math.round(v * inv)
}

function edgeKey(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): string {
  const a0 = q(ax)
  const a1 = q(ay)
  const a2 = q(az)
  const b0 = q(bx)
  const b1 = q(by)
  const b2 = q(bz)
  if (a0 < b0 || (a0 === b0 && a1 < b1) || (a0 === b0 && a1 === b1 && a2 <= b2)) {
    return `${a0},${a1},${a2}|${b0},${b1},${b2}`
  }
  return `${b0},${b1},${b2}|${a0},${a1},${a2}`
}

export function findNearestTriangle(
  positions: Float32Array,
  triangleCount: number,
  point: readonly [number, number, number],
): number {
  const [px, py, pz] = point
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < triangleCount; i++) {
    const [cx, cy, cz] = triCentroid(positions, i)
    const d2 = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2
    if (d2 < bestD) {
      bestD = d2
      best = i
    }
  }
  return best
}

/**
 * Build smooth adjacency ONLY among the given triangle indices (local subset).
 * O(k) in subset size — not O(whole mesh).
 */
export function buildSmoothAdjacencyForSubset(
  positions: Float32Array,
  normals: Float32Array,
  triIndices: number[],
  featureAngleDeg = 38,
): Map<number, number[]> {
  const cosLimit = Math.cos((featureAngleDeg * Math.PI) / 180)
  const edgeTris = new Map<string, number[]>()

  for (const i of triIndices) {
    const o = i * 9
    const verts: Array<[number, number, number]> = [
      [positions[o], positions[o + 1], positions[o + 2]],
      [positions[o + 3], positions[o + 4], positions[o + 5]],
      [positions[o + 6], positions[o + 7], positions[o + 8]],
    ]
    for (let e = 0; e < 3; e++) {
      const a = verts[e]
      const b = verts[(e + 1) % 3]
      const key = edgeKey(a[0], a[1], a[2], b[0], b[1], b[2])
      let list = edgeTris.get(key)
      if (!list) {
        list = []
        edgeTris.set(key, list)
      }
      if (list.length < 2) list.push(i)
    }
  }

  const adj = new Map<number, number[]>()
  for (const i of triIndices) adj.set(i, [])

  for (const pair of edgeTris.values()) {
    if (pair.length !== 2) continue
    const [t0, t1] = pair
    const n0x = normals[t0 * 3]
    const n0y = normals[t0 * 3 + 1]
    const n0z = normals[t0 * 3 + 2]
    const n1x = normals[t1 * 3]
    const n1y = normals[t1 * 3 + 1]
    const n1z = normals[t1 * 3 + 2]
    const dot = n0x * n1x + n0y * n1y + n0z * n1z
    if (dot < cosLimit) continue // sharp crease = barrier
    adj.get(t0)!.push(t1)
    adj.get(t1)!.push(t0)
  }
  return adj
}

/** Full-mesh adjacency (tests / tiny meshes only). */
export function buildSmoothAdjacency(
  positions: Float32Array,
  normals: Float32Array,
  triangleCount: number,
  featureAngleDeg = 38,
): number[][] {
  const indices = Array.from({ length: triangleCount }, (_, i) => i)
  const map = buildSmoothAdjacencyForSubset(positions, normals, indices, featureAngleDeg)
  const adj: number[][] = Array.from({ length: triangleCount }, () => [])
  for (const [i, neigh] of map) adj[i] = neigh
  return adj
}

export function floodFillRegion(
  adj: number[][] | Map<number, number[]>,
  seed: number,
  maxTris = 80_000,
): number[] {
  const get = (i: number): number[] =>
    Array.isArray(adj) ? (adj as number[][])[i] ?? [] : (adj as Map<number, number[]>).get(i) ?? []

  const seen = new Set<number>()
  const out: number[] = []
  const stack = [seed]
  seen.add(seed)
  while (stack.length > 0 && out.length < maxTris) {
    const t = stack.pop()!
    out.push(t)
    for (const u of get(t)) {
      if (seen.has(u)) continue
      seen.add(u)
      stack.push(u)
    }
  }
  return out
}

/**
 * Collect triangle indices whose centroid is within radiusMm of point.
 * This bounds fill work on multi-million-tri sculpts.
 */
export function collectNearbyTriangles(
  positions: Float32Array,
  triangleCount: number,
  point: readonly [number, number, number],
  radiusMm: number,
): number[] {
  const [px, py, pz] = point
  const r2 = radiusMm * radiusMm
  const out: number[] = []
  for (let i = 0; i < triangleCount; i++) {
    const [cx, cy, cz] = triCentroid(positions, i)
    const d2 = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2
    if (d2 <= r2) out.push(i)
  }
  return out
}

export async function applyPaintBrush(
  mesh: BaseMesh,
  op: PaintBrushParams,
  _faces: SemanticFace[],
): Promise<BaseMesh> {
  const target = op.extruder ?? 'B'
  const mode = op.mode ?? 'radius'
  const extruders = mesh.extruders.slice() as Array<'A' | 'B'>

  if (mode === 'fill') {
    const seed = findNearestTriangle(mesh.positions, mesh.triangleCount, op.point)
    // Local window: large enough for a faceplate / panel, not the whole bust.
    // Expand if the seed region looks truncated at the boundary.
    let radius = Math.max(op.radiusMm ?? 14, 45)
    const diag =
      Math.hypot(mesh.bbox.size[0], mesh.bbox.size[1], mesh.bbox.size[2]) || 100
    radius = Math.min(radius, diag * 0.35)

    let nearby = collectNearbyTriangles(
      mesh.positions,
      mesh.triangleCount,
      op.point,
      radius,
    )
    // Ensure seed is included
    if (!nearby.includes(seed)) nearby = [seed, ...nearby]

    // Tiny meshes: use all triangles
    if (mesh.triangleCount <= 8000) {
      nearby = Array.from({ length: mesh.triangleCount }, (_, i) => i)
    }

    const adj = buildSmoothAdjacencyForSubset(
      mesh.positions,
      mesh.normals,
      nearby,
      op.featureAngleDeg ?? 38,
    )
    let region = floodFillRegion(adj, seed)

    // If fill hit the spatial window edge with many border tris, grow once
    if (
      mesh.triangleCount > 8000 &&
      region.length > nearby.length * 0.55 &&
      radius < diag * 0.5
    ) {
      nearby = collectNearbyTriangles(
        mesh.positions,
        mesh.triangleCount,
        op.point,
        Math.min(radius * 1.6, diag * 0.5),
      )
      if (!nearby.includes(seed)) nearby.push(seed)
      const adj2 = buildSmoothAdjacencyForSubset(
        mesh.positions,
        mesh.normals,
        nearby,
        op.featureAngleDeg ?? 38,
      )
      region = floodFillRegion(adj2, seed)
    }

    // Safety on large sculpts: runaway fill → modest radius brush
    if (mesh.triangleCount > 2000 && region.length > mesh.triangleCount * 0.4) {
      return applyPaintBrush(
        mesh,
        { ...op, mode: 'radius', radiusMm: op.radiusMm ?? 16 },
        _faces,
      )
    }

    for (const i of region) extruders[i] = target
    return { ...mesh, extruders }
  }

  // ── radius brush ───────────────────────────────────────────────────
  const [px, py, pz] = op.point
  const r = op.radiusMm ?? 12
  const r2 = r * r
  let hit = 0

  for (let i = 0; i < mesh.triangleCount; i++) {
    const [cx, cy, cz] = triCentroid(mesh.positions, i)
    const d2 = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2
    if (d2 <= r2) {
      extruders[i] = target
      hit++
    }
  }

  if (hit === 0) {
    extruders[findNearestTriangle(mesh.positions, mesh.triangleCount, op.point)] = target
  }

  return { ...mesh, extruders }
}
