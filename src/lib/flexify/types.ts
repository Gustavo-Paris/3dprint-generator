/**
 * Shared types for the flexify pipeline — hybridizes a fused Meshy mesh
 * with the joint structure of a known-working flexi reference (Rocktopus).
 */
import type { BaseMesh } from '@/lib/import/types'

export interface AlignedPair {
  /** Meshy mesh, centered at origin, original scale. */
  meshy: BaseMesh
  /** Rocktopus mesh, centered at origin, scaled to match Meshy's XY footprint. */
  rocktopus: BaseMesh
  /** Scale factor applied to the Rocktopus (rocktopusOriginal × scale = aligned). */
  rocktopusScale: number
}

/** A connected-component cluster of triangle indices from a parent BaseMesh. */
export interface MeshComponent {
  id: number
  triangleIndices: number[]
  /** Number of triangles in the component (cached). */
  triangleCount: number
  /** Component bbox in the parent's coordinate frame. */
  bbox: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
    center: [number, number, number]
  }
}

/** A flexi joint between two adjacent components. */
export interface JointConnection {
  /** Component id on the "inner" side (closer to body center — gets the socket). */
  socketComponentId: number
  /** Component id on the "outer" side (further from body center — gets the ball). */
  ballComponentId: number
  /** Center of the joint in world coords (midpoint of closest vertex pair). */
  center: [number, number, number]
  /** Minimum vertex-to-vertex distance found between the two components. */
  minDistance: number
}
