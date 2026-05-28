/**
 * F2 — Decompose a flexi mesh into its connected components and build
 * the connection graph between them.
 *
 * Reuses the same vertex-weld + union-find algorithm from
 * `src/scripts/analyze-flexi.ts`, productionized into a reusable helper.
 *
 * Outputs:
 *  - components[]: triangle index lists + bbox per disjoint mesh region
 *  - connections[]: pairs of adjacent components with joint center
 */
import type { BaseMesh } from '@/lib/import/types'
import type { MeshComponent, JointConnection } from './types'

const WELD_EPS = 1e-4
const WELD_QUANT = 1 / WELD_EPS

class UnionFind {
  parent: Int32Array
  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

/** Decompose a mesh into connected components by vertex welding. */
export function decompose(mesh: BaseMesh): MeshComponent[] {
  // Weld vertices by quantized position
  const vertMap = new Map<string, number>()
  const triVerts = new Int32Array(mesh.triangleCount * 3)
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9
    for (let v = 0; v < 3; v++) {
      const x = Math.round(mesh.positions[o + v * 3] * WELD_QUANT)
      const y = Math.round(mesh.positions[o + v * 3 + 1] * WELD_QUANT)
      const z = Math.round(mesh.positions[o + v * 3 + 2] * WELD_QUANT)
      const key = `${x},${y},${z}`
      let id = vertMap.get(key)
      if (id === undefined) {
        id = vertMap.size
        vertMap.set(key, id)
      }
      triVerts[t * 3 + v] = id
    }
  }

  // Union-find via shared edges
  const uf = new UnionFind(vertMap.size)
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2]
    uf.union(v0, v1)
    uf.union(v0, v2)
  }

  // Group triangles by component root
  const compMap = new Map<number, number[]>()
  for (let t = 0; t < mesh.triangleCount; t++) {
    const root = uf.find(triVerts[t * 3])
    let list = compMap.get(root)
    if (!list) { list = []; compMap.set(root, list) }
    list.push(t)
  }

  // Sort components by size (largest first), build MeshComponent[]
  const sorted = [...compMap.values()].sort((a, b) => b.length - a.length)
  return sorted.map((tris, id) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const t of tris) {
      const o = t * 9
      for (let v = 0; v < 3; v++) {
        const x = mesh.positions[o + v * 3]
        const y = mesh.positions[o + v * 3 + 1]
        const z = mesh.positions[o + v * 3 + 2]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
    }
    return {
      id,
      triangleIndices: tris,
      triangleCount: tris.length,
      bbox: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size: [maxX - minX, maxY - minY, maxZ - minZ],
        center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      },
    }
  })
}

/**
 * For each component, collect its representative vertex positions in
 * a flat Float32Array (deduped via welding). Used by the connection
 * graph builder to compute closest-pair distances between components.
 */
function collectVerts(mesh: BaseMesh, comp: MeshComponent): Float32Array {
  const seen = new Set<string>()
  const out: number[] = []
  for (const t of comp.triangleIndices) {
    const o = t * 9
    for (let v = 0; v < 3; v++) {
      const x = mesh.positions[o + v * 3]
      const y = mesh.positions[o + v * 3 + 1]
      const z = mesh.positions[o + v * 3 + 2]
      const key = `${Math.round(x * WELD_QUANT)},${Math.round(y * WELD_QUANT)},${Math.round(z * WELD_QUANT)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(x, y, z)
    }
  }
  return new Float32Array(out)
}

/** AABB-AABB minimum distance — returns 0 if they overlap. */
function aabbDistance(a: MeshComponent, b: MeshComponent): number {
  const dx = Math.max(0, Math.max(a.bbox.min[0] - b.bbox.max[0], b.bbox.min[0] - a.bbox.max[0]))
  const dy = Math.max(0, Math.max(a.bbox.min[1] - b.bbox.max[1], b.bbox.min[1] - a.bbox.max[1]))
  const dz = Math.max(0, Math.max(a.bbox.min[2] - b.bbox.max[2], b.bbox.min[2] - a.bbox.max[2]))
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

interface ClosestPair {
  distance: number
  pointA: [number, number, number]
  pointB: [number, number, number]
}

/** Brute-force closest vertex pair between two vertex sets. */
function closestVertexPair(va: Float32Array, vb: Float32Array): ClosestPair {
  let best = Infinity
  let pa: [number, number, number] = [0, 0, 0]
  let pb: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < va.length; i += 3) {
    const ax = va[i], ay = va[i + 1], az = va[i + 2]
    for (let j = 0; j < vb.length; j += 3) {
      const bx = vb[j], by = vb[j + 1], bz = vb[j + 2]
      const d2 = (ax - bx) * (ax - bx) + (ay - by) * (ay - by) + (az - bz) * (az - bz)
      if (d2 < best) {
        best = d2
        pa = [ax, ay, az]
        pb = [bx, by, bz]
      }
    }
  }
  return { distance: Math.sqrt(best), pointA: pa, pointB: pb }
}

export interface ConnectionGraphOptions {
  /** Components within this AABB distance are candidates for a connection.
   *  Defaults to 4mm — covers ball-joint clearances + small slack. */
  candidateAabbMm?: number
  /** A candidate is upgraded to a real connection if its closest vertex pair
   *  is within this distance. Defaults to 2mm. */
  jointThresholdMm?: number
}

/**
 * Build the connection graph: for every pair of components whose AABBs
 * are nearly touching, compute the actual closest vertex pair and, if
 * close enough, record a JointConnection with the midpoint as the joint center.
 *
 * "socket" vs "ball" side: the component whose centroid is closer to the
 * world origin (i.e. the body/center of the octopus) gets the socket; the
 * outer one gets the ball. This matches the natural hierarchy of a flexi:
 * body → seg1 → seg2 → ... → tip.
 */
export function buildConnectionGraph(
  mesh: BaseMesh,
  components: MeshComponent[],
  opts: ConnectionGraphOptions = {},
): JointConnection[] {
  const candidateAabb = opts.candidateAabbMm ?? 4
  const jointThreshold = opts.jointThresholdMm ?? 2

  const vertCache: Float32Array[] = components.map((c) => collectVerts(mesh, c))
  const radius = components.map((c) => Math.sqrt(c.bbox.center[0] ** 2 + c.bbox.center[1] ** 2 + c.bbox.center[2] ** 2))

  const connections: JointConnection[] = []
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      if (aabbDistance(components[i], components[j]) > candidateAabb) continue
      const { distance, pointA, pointB } = closestVertexPair(vertCache[i], vertCache[j])
      if (distance > jointThreshold) continue
      const inner = radius[i] <= radius[j] ? i : j
      const outer = inner === i ? j : i
      connections.push({
        socketComponentId: inner,
        ballComponentId: outer,
        center: [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2, (pointA[2] + pointB[2]) / 2],
        minDistance: distance,
      })
    }
  }
  return connections
}
