/**
 * F3 — Assign Meshy triangles to Rocktopus components by spatial proximity.
 *
 * Strategy (chosen for speed + memory; deliberately avoids JSCAD CSG):
 *   For every Meshy triangle, compute its centroid; assign the triangle
 *   to the Rocktopus component whose padded bbox contains it. If a
 *   centroid sits inside multiple component bboxes (the padded regions
 *   overlap near joints), pick the component whose bbox center is
 *   closest. If a centroid is outside every bbox, the triangle is
 *   dropped (this happens mostly at the silhouette where the Meshy
 *   sticks out further than the Rocktopus envelope).
 *
 * Output: one BaseMesh-shaped chunk per Rocktopus component. Chunks
 * have jagged edges where they were "torn" along bbox boundaries — the
 * joint primitives in F4/F5 will cover the open boundaries.
 *
 * Performance: O(M × N) where M = Meshy tris and N = components. With
 * 1M tris × 41 components = 41M cheap point-in-AABB tests, ~1s.
 */
import type { BaseMesh } from '@/lib/import/types'
import type { MeshComponent } from './types'

const DEFAULT_PADDING_MM = 1.5

interface BboxPadded {
  min: [number, number, number]
  max: [number, number, number]
  center: [number, number, number]
}

function padBbox(c: MeshComponent, pad: number): BboxPadded {
  return {
    min: [c.bbox.min[0] - pad, c.bbox.min[1] - pad, c.bbox.min[2] - pad],
    max: [c.bbox.max[0] + pad, c.bbox.max[1] + pad, c.bbox.max[2] + pad],
    center: c.bbox.center,
  }
}

function pointInBbox(x: number, y: number, z: number, b: BboxPadded): boolean {
  return x >= b.min[0] && x <= b.max[0]
      && y >= b.min[1] && y <= b.max[1]
      && z >= b.min[2] && z <= b.max[2]
}

function squaredDistance(x: number, y: number, z: number, c: [number, number, number]): number {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2]
  return dx * dx + dy * dy + dz * dz
}

/** Squared distance from a point to the nearest face of an AABB. 0 if inside. */
function pointToBboxSquared(x: number, y: number, z: number, b: BboxPadded): number {
  const dx = Math.max(b.min[0] - x, 0, x - b.max[0])
  const dy = Math.max(b.min[1] - y, 0, y - b.max[1])
  const dz = Math.max(b.min[2] - z, 0, z - b.max[2])
  return dx * dx + dy * dy + dz * dz
}

export interface ChunkOptions {
  /** AABB expansion (mm) applied to each component before assignment. Default 1.5. */
  paddingMm?: number
}

export interface MeshChunk {
  /** Component id this chunk belongs to. */
  componentId: number
  /** Triangle positions (flat Float32, length = tris × 9). May be empty. */
  positions: Float32Array
  /** Mirrors BaseMesh.extruders, per triangle. */
  extruders: Array<'A' | 'B'>
  triangleCount: number
}

/** Bucket Meshy triangles into chunks aligned with the Rocktopus components. */
export function chunkMeshByComponents(
  meshy: BaseMesh,
  components: MeshComponent[],
  opts: ChunkOptions = {},
): MeshChunk[] {
  const pad = opts.paddingMm ?? DEFAULT_PADDING_MM
  const padded = components.map((c) => padBbox(c, pad))

  // Bucket triangle indices per component (use plain arrays — flat ones get
  // sliced into Float32Array at the end).
  const buckets: number[][] = components.map(() => [])

  for (let t = 0; t < meshy.triangleCount; t++) {
    const o = t * 9
    const cx = (meshy.positions[o] + meshy.positions[o + 3] + meshy.positions[o + 6]) / 3
    const cy = (meshy.positions[o + 1] + meshy.positions[o + 4] + meshy.positions[o + 7]) / 3
    const cz = (meshy.positions[o + 2] + meshy.positions[o + 5] + meshy.positions[o + 8]) / 3

    // Pass 1: pick the bbox that CONTAINS the centroid, tiebreaker by
    // bbox-center distance (joints make adjacent bboxes overlap).
    let best = -1
    let bestDist = Infinity
    for (let c = 0; c < padded.length; c++) {
      if (!pointInBbox(cx, cy, cz, padded[c])) continue
      const d = squaredDistance(cx, cy, cz, padded[c].center)
      if (d < bestDist) { bestDist = d; best = c }
    }
    // Pass 2 (fallback): no bbox contains the centroid — assign to the
    // nearest bbox by point-AABB distance. Keeps every Meshy triangle
    // claimed by exactly one component (no dropped silhouette geometry).
    if (best < 0) {
      bestDist = Infinity
      for (let c = 0; c < padded.length; c++) {
        const d = pointToBboxSquared(cx, cy, cz, padded[c])
        if (d < bestDist) { bestDist = d; best = c }
      }
    }
    buckets[best].push(t)
  }

  return buckets.map((tris, componentId) => {
    const positions = new Float32Array(tris.length * 9)
    const extruders: Array<'A' | 'B'> = new Array(tris.length)
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i]
      positions.set(meshy.positions.subarray(t * 9, t * 9 + 9), i * 9)
      extruders[i] = meshy.extruders[t]
    }
    return { componentId, positions, extruders, triangleCount: tris.length }
  })
}
