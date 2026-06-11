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
  return scaleMeshNonUniform(mesh, [s, s, s])
}

/** Scale per-axis. Normals stay valid only if scale is uniform; for
 *  non-uniform scale we recompute them. */
export function scaleMeshNonUniform(mesh: BaseMesh, s: [number, number, number]): BaseMesh {
  if (s[0] === 1 && s[1] === 1 && s[2] === 1) return mesh
  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i]     = mesh.positions[i]     * s[0]
    positions[i + 1] = mesh.positions[i + 1] * s[1]
    positions[i + 2] = mesh.positions[i + 2] * s[2]
  }
  // Recompute normals (under non-uniform scale they change direction).
  const triCount = mesh.triangleCount
  const normals = new Float32Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= len; ny /= len; nz /= len
    normals[t * 3] = nx
    normals[t * 3 + 1] = ny
    normals[t * 3 + 2] = nz
  }
  return {
    positions,
    normals,
    extruders: mesh.extruders,
    triangleCount: mesh.triangleCount,
    bbox: {
      min: [mesh.bbox.min[0] * s[0], mesh.bbox.min[1] * s[1], mesh.bbox.min[2] * s[2]],
      max: [mesh.bbox.max[0] * s[0], mesh.bbox.max[1] * s[1], mesh.bbox.max[2] * s[2]],
      size: [mesh.bbox.size[0] * s[0], mesh.bbox.size[1] * s[1], mesh.bbox.size[2] * s[2]],
      center: [mesh.bbox.center[0] * s[0], mesh.bbox.center[1] * s[1], mesh.bbox.center[2] * s[2]],
    },
  }
}

/**
 * Align the Meshy and Rocktopus meshes into a shared coordinate frame.
 *
 * Two-step alignment, both centered at origin afterward:
 *   1. Scale Rocktopus uniformly so its larger XY axis matches the
 *      Meshy's larger XY axis (octopus footprint match).
 *   2. Scale the Meshy NON-UNIFORMLY in Z so its Z extent matches the
 *      now-scaled Rocktopus's Z extent. This is the key fix: without
 *      it, the tall Meshy (e.g. cthulhu standing 120mm) sits "above"
 *      the flat Rocktopus (93mm scaled) and the chunking assigns the
 *      upper body to the Rocktopus body component without spatial
 *      overlap → Vin Diesel kraken effect.
 *
 * The user accepted "Rocktopus silhouette + Meshy aesthetic", so
 * squishing the Meshy into the Rocktopus envelope is the right move.
 */
export function alignMeshes(meshyOriginal: BaseMesh, rocktopusOriginal: BaseMesh): AlignedPair {
  const meshyCentered = centerAtOrigin(meshyOriginal)
  const rocktopusCentered = centerAtOrigin(rocktopusOriginal)

  // Step 1: scale Rocktopus to match Meshy XY footprint
  const meshyXY = Math.max(meshyCentered.bbox.size[0], meshyCentered.bbox.size[1])
  const rockXY = Math.max(rocktopusCentered.bbox.size[0], rocktopusCentered.bbox.size[1])
  const rocktopusScale = meshyXY / rockXY
  const rocktopus = scaleMesh(rocktopusCentered, rocktopusScale)

  // Step 2: squish Meshy in Z to match the (now-scaled) Rocktopus's Z extent
  const zScale = rocktopus.bbox.size[2] / meshyCentered.bbox.size[2]
  const meshy = scaleMeshNonUniform(meshyCentered, [1, 1, zScale])

  return { meshy, rocktopus, rocktopusScale }
}
