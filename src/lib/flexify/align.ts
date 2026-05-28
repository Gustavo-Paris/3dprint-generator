/**
 * F1 — Alignment + scaling.
 *
 * Brings the Meshy fused mesh and the Rocktopus reference flexi into the
 * same coordinate frame: both centered at origin, both Z-up (body up,
 * tentacles down), Rocktopus uniformly scaled so its XY footprint matches
 * the Meshy's. This is the precondition for every later step (component
 * detection, bbox slicing, joint placement).
 *
 * No rotation logic yet — both reference meshes are assumed Z-up. If a
 * future input comes in misoriented, add PCA-based orientation here.
 */
import type { BaseMesh } from '@/lib/import/types'
import type { AlignedPair } from './types'

/** Subtract the bbox center from every vertex so the mesh sits at origin. */
export function centerAtOrigin(mesh: BaseMesh): BaseMesh {
  const cx = mesh.bbox.center[0]
  const cy = mesh.bbox.center[1]
  const cz = mesh.bbox.center[2]
  if (cx === 0 && cy === 0 && cz === 0) return mesh

  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i]     = mesh.positions[i]     - cx
    positions[i + 1] = mesh.positions[i + 1] - cy
    positions[i + 2] = mesh.positions[i + 2] - cz
  }
  // Normals are direction-only; translation doesn't affect them. Reuse.
  return {
    positions,
    normals: mesh.normals,
    extruders: mesh.extruders,
    triangleCount: mesh.triangleCount,
    bbox: {
      min: [mesh.bbox.min[0] - cx, mesh.bbox.min[1] - cy, mesh.bbox.min[2] - cz],
      max: [mesh.bbox.max[0] - cx, mesh.bbox.max[1] - cy, mesh.bbox.max[2] - cz],
      size: mesh.bbox.size,
      center: [0, 0, 0],
    },
  }
}

/** Multiply every vertex by `s`. Uniform scale only. */
export function scaleMesh(mesh: BaseMesh, s: number): BaseMesh {
  if (s === 1) return mesh
  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i++) positions[i] = mesh.positions[i] * s
  // Normals are unit vectors — invariant under uniform scale. Reuse.
  return {
    positions,
    normals: mesh.normals,
    extruders: mesh.extruders,
    triangleCount: mesh.triangleCount,
    bbox: {
      min: [mesh.bbox.min[0] * s, mesh.bbox.min[1] * s, mesh.bbox.min[2] * s],
      max: [mesh.bbox.max[0] * s, mesh.bbox.max[1] * s, mesh.bbox.max[2] * s],
      size: [mesh.bbox.size[0] * s, mesh.bbox.size[1] * s, mesh.bbox.size[2] * s],
      center: [mesh.bbox.center[0] * s, mesh.bbox.center[1] * s, mesh.bbox.center[2] * s],
    },
  }
}

/**
 * Align the Meshy and Rocktopus meshes into a shared coordinate frame.
 *
 * Strategy: both meshes centered at origin; Rocktopus scaled uniformly
 * so its larger XY axis matches the Meshy's larger XY axis. This keeps
 * the Z relationship intact — the result is a Rocktopus with tentacles
 * radiating the same width as the Meshy, but slightly shorter vertically
 * (the user accepted this tradeoff).
 */
export function alignMeshes(meshyOriginal: BaseMesh, rocktopusOriginal: BaseMesh): AlignedPair {
  const meshy = centerAtOrigin(meshyOriginal)
  const rocktopusCentered = centerAtOrigin(rocktopusOriginal)

  const meshyXY = Math.max(meshy.bbox.size[0], meshy.bbox.size[1])
  const rockXY = Math.max(rocktopusCentered.bbox.size[0], rocktopusCentered.bbox.size[1])
  const scale = meshyXY / rockXY

  const rocktopus = scaleMesh(rocktopusCentered, scale)

  return { meshy, rocktopus, rocktopusScale: scale }
}
