/**
 * F5 — Per-component assembly.
 *
 * For each Rocktopus component, build the final hybrid body:
 *   1. Take the Meshy chunk for that component
 *   2. Drop chunk triangles whose centroid lies inside any joint donation
 *      sphere involving this component (those zones are the joint's territory)
 *   3. Append the Rocktopus joint geometry for every joint involving this
 *      component (as socket or ball)
 *   4. If the resulting body is empty (tip component with no Meshy reach),
 *      fall back to the Rocktopus component's geometry verbatim
 *
 * Output: 41 BaseMesh-shaped bodies, each tagged with an extruder for the
 * serializer. No CSG involved — pure triangle bucketing.
 */
import type { BaseMesh } from '@/lib/import/types'
import type { MeshComponent, JointConnection } from './types'
import type { MeshChunk } from './chunk'
import type { JointDonation } from './joints'

export interface AssembledBody {
  componentId: number
  positions: Float32Array
  /** Per-triangle extruder, length = triangleCount. */
  extruders: Array<'A' | 'B'>
  triangleCount: number
  /** True when no Meshy triangles reached this component — Rocktopus geometry used. */
  fallbackUsed: boolean
}

interface SphereExclusion {
  cx: number
  cy: number
  cz: number
  r2: number
}

/** Build the list of donation spheres that exclude Meshy triangles for component `compId`. */
function exclusionsFor(compId: number, conns: JointConnection[], donations: JointDonation[]): SphereExclusion[] {
  const out: SphereExclusion[] = []
  for (let j = 0; j < conns.length; j++) {
    const c = conns[j]
    if (c.socketComponentId !== compId && c.ballComponentId !== compId) continue
    const d = donations[j]
    out.push({ cx: d.center[0], cy: d.center[1], cz: d.center[2], r2: d.radius * d.radius })
  }
  return out
}

function inAnySphere(x: number, y: number, z: number, spheres: SphereExclusion[]): boolean {
  for (const s of spheres) {
    const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz
    if (dx * dx + dy * dy + dz * dz <= s.r2) return true
  }
  return false
}

function extractTriangleCenter(positions: Float32Array, offset: number): [number, number, number] {
  return [
    (positions[offset] + positions[offset + 3] + positions[offset + 6]) / 3,
    (positions[offset + 1] + positions[offset + 4] + positions[offset + 7]) / 3,
    (positions[offset + 2] + positions[offset + 5] + positions[offset + 8]) / 3,
  ]
}

/** Collect the Rocktopus triangles for a single component into a flat array. */
function rocktopusComponentPositions(rocktopus: BaseMesh, comp: MeshComponent): Float32Array {
  const out = new Float32Array(comp.triangleCount * 9)
  let off = 0
  for (const t of comp.triangleIndices) {
    out.set(rocktopus.positions.subarray(t * 9, t * 9 + 9), off)
    off += 9
  }
  return out
}

export interface AssembleOptions {
  /**
   * Body-default extruder. Defaults to 'A' (base color). Logo / joint regions
   * could be tagged 'B' if desired; for the MVP we keep everything on A.
   */
  bodyExtruder?: 'A' | 'B'
}

export function assembleBodies(
  rocktopus: BaseMesh,
  components: MeshComponent[],
  _connections: JointConnection[],
  chunks: MeshChunk[],
  _donations: JointDonation[],
  opts: AssembleOptions = {},
): AssembledBody[] {
  const baseExtruder: 'A' | 'B' = opts.bodyExtruder ?? 'A'
  const bodies: AssembledBody[] = []

  // Simplified strategy: each body = whole Rocktopus component (closed,
  // already articulating) + the Meshy chunk for that component (open,
  // overlapping shell that adds surface detail). The slicer treats them
  // as a volumetric union per object. Adjacent bodies don't share vertices
  // because each is its own <object> in the 3MF — the slicer never welds
  // across objects. Joint donations (F4) are unused in this MVP path; we
  // get joint geometry for free from the whole Rocktopus component.
  void _connections
  void _donations

  for (let i = 0; i < components.length; i++) {
    const chunk = chunks[i]
    const rocktopusTris = rocktopusComponentPositions(rocktopus, components[i])

    // Concatenate: Rocktopus component first (the closed skeleton), then
    // the Meshy chunk on top.
    const totalLen = rocktopusTris.length + chunk.positions.length
    const positions = new Float32Array(totalLen)
    positions.set(rocktopusTris, 0)
    positions.set(chunk.positions, rocktopusTris.length)

    const extruders: Array<'A' | 'B'> = new Array(totalLen / 9)
    for (let k = 0; k < components[i].triangleCount; k++) extruders[k] = baseExtruder
    for (let k = 0; k < chunk.triangleCount; k++) {
      extruders[components[i].triangleCount + k] = chunk.extruders[k]
    }

    bodies.push({
      componentId: i,
      positions,
      extruders,
      triangleCount: positions.length / 9,
      // "fallback" is irrelevant in this strategy — Rocktopus is always present.
      fallbackUsed: chunk.triangleCount === 0,
    })
  }

  // Suppress "unused param" warnings without disabling lint
  void extractTriangleCenter
  void inAnySphere
  void exclusionsFor
  return bodies
}
