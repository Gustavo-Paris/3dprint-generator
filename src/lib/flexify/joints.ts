/**
 * F4 — Joint donation.
 *
 * Instead of generating ball-and-socket primitives procedurally (which is
 * fragile: clearances, neck geometry, FDM printability — all easy to get
 * wrong), we DONATE the joint geometry directly from the Rocktopus. The
 * Rocktopus's joints are already designed and proven to work; we just
 * harvest the local triangles around each connection center and keep
 * them in the output as-is.
 *
 * Strategy:
 *   For each JointConnection at point P, define a "donation sphere" of
 *   radius R around P. Collect Rocktopus triangles inside the sphere,
 *   split by which component they belong to (socket vs ball).
 *
 * R sizing: based on the smaller of the two components' bbox min dim,
 * scaled by 0.7 — large enough to cover the actual joint surface, small
 * enough to not invade the rest of the segment.
 */
import type { BaseMesh } from '@/lib/import/types'
import type { MeshComponent, JointConnection } from './types'

export interface JointDonation {
  /** Index into the JointConnection[] array. */
  jointIndex: number
  /** Center of the donation region. */
  center: [number, number, number]
  /** Radius — triangles whose centroids fall within this distance are donated. */
  radius: number
  /** Triangles donated to the socket-side component. Flat positions. */
  socketTriangles: Float32Array
  /** Triangles donated to the ball-side component. Flat positions. */
  ballTriangles: Float32Array
}

function triCentroid(positions: Float32Array, t: number): [number, number, number] {
  const o = t * 9
  return [
    (positions[o] + positions[o + 3] + positions[o + 6]) / 3,
    (positions[o + 1] + positions[o + 4] + positions[o + 7]) / 3,
    (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3,
  ]
}

function triPositions(positions: Float32Array, t: number): number[] {
  const o = t * 9
  return [
    positions[o],     positions[o + 1], positions[o + 2],
    positions[o + 3], positions[o + 4], positions[o + 5],
    positions[o + 6], positions[o + 7], positions[o + 8],
  ]
}

function collectInSphere(
  mesh: BaseMesh,
  triangleIndices: number[],
  center: [number, number, number],
  radius: number,
): Float32Array {
  const r2 = radius * radius
  const out: number[] = []
  for (const t of triangleIndices) {
    const c = triCentroid(mesh.positions, t)
    const dx = c[0] - center[0], dy = c[1] - center[1], dz = c[2] - center[2]
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(...triPositions(mesh.positions, t))
  }
  return new Float32Array(out)
}

export interface JointDonationOptions {
  /** Multiplier on the smaller component's min bbox dimension to set donation radius. Default 0.7. */
  radiusFactor?: number
  /** Minimum donation radius regardless of component size (mm). Default 2. */
  minRadiusMm?: number
  /** Maximum donation radius (mm). Default 8. */
  maxRadiusMm?: number
}

export function buildJointDonations(
  rocktopus: BaseMesh,
  components: MeshComponent[],
  connections: JointConnection[],
  opts: JointDonationOptions = {},
): JointDonation[] {
  const factor = opts.radiusFactor ?? 0.7
  const minR = opts.minRadiusMm ?? 2
  const maxR = opts.maxRadiusMm ?? 8

  return connections.map((conn, jointIndex) => {
    const socket = components[conn.socketComponentId]
    const ball = components[conn.ballComponentId]
    const smallerMinDim = Math.min(
      Math.min(...socket.bbox.size),
      Math.min(...ball.bbox.size),
    )
    const radius = Math.max(minR, Math.min(maxR, smallerMinDim * factor))

    const socketTriangles = collectInSphere(rocktopus, socket.triangleIndices, conn.center, radius)
    const ballTriangles = collectInSphere(rocktopus, ball.triangleIndices, conn.center, radius)

    return {
      jointIndex,
      center: conn.center,
      radius,
      socketTriangles,
      ballTriangles,
    }
  })
}
