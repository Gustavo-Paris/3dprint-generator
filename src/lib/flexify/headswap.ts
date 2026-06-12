/**
 * Head-swap pipeline — alternate flexify path for the case where the user
 * has a working flexi base (e.g. OctoCustom) designed to host a custom
 * head on top, and a separate Meshy mesh whose head region they want
 * planted on the base.
 *
 * EXPERIMENTAL / CLI-ONLY: reachable only via `src/scripts/headswap-cli.ts`
 * (`pnpm tsx src/scripts/headswap-cli.ts <octopus.3mf> <meshy.3mf> <out.3mf>`).
 * No API route or UI exposes it. Not part of the shipped product surface; the
 * web flexify entry point is `src/app/api/flexify/route.ts`.
 *
 * Pipeline:
 *   1. Load both meshes
 *   2. Slice the Meshy mesh by Z, keeping only triangles above a cutoff
 *      (the head/neck region — tentacles below are discarded)
 *   3. Center the extracted head in XY at the origin
 *   4. Uniformly scale the head so its max XY ≈ target width × OctoCustom body width
 *   5. Translate the head so its bottom sits just above the OctoCustom body top
 *   6. Output: every OctoCustom component (preserved as-is) + 1 extra body for the head
 *
 * The result is a multi-body 3MF where the slicer treats each component
 * as a separate physical part. Joints articulate as designed; the head
 * is fused (single body) sitting on top of the OctoCustom body component.
 */
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { serialize3mf, type MeshBodyData } from '@/lib/3mf/serialize-3mf'
import { decompose } from './decompose'
import type { BaseMesh } from '@/lib/import/types'

export interface HeadSwapOptions {
  /** Cutoff in the Meshy's ORIGINAL z (before centering). Triangles with
   *  all 3 vertices below this z are dropped. Default 36 (drops 88% of
   *  tris in the example cthulhu — leaves head + neck). */
  meshyHeadCutoffZ?: number
  /** Target head width as a multiple of the OctoCustom body width.
   *  1.0 = same width. 1.2 = head 20% larger (heroic). Default 1.2. */
  headWidthFactor?: number
  /** Z overlap (mm) between the head bottom and OctoCustom body top.
   *  Negative = gap, positive = embedding. Default 1.0 (head pokes 1mm
   *  into the body for a clean visual merge). */
  embedDepthMm?: number
}

export interface HeadSwapReport {
  octopusComponentCount: number
  headTriangleCount: number
  headBboxMm: [number, number, number]
  headTranslateMm: [number, number, number]
  headScale: number
  octopusBodyBboxMm: [number, number, number]
}

/** Keep triangles whose vertices ALL sit above `cutoffZ` in the original
 *  coordinates (before any transform). Output: a new mesh with just the
 *  surviving triangles. */
function sliceMeshAboveZ(mesh: BaseMesh, cutoffZ: number): BaseMesh {
  const keep: number[] = []
  const keepExtruders: Array<'A' | 'B'> = []
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9
    const z0 = mesh.positions[o + 2]
    const z1 = mesh.positions[o + 5]
    const z2 = mesh.positions[o + 8]
    if (z0 < cutoffZ && z1 < cutoffZ && z2 < cutoffZ) continue
    for (let k = 0; k < 9; k++) keep.push(mesh.positions[o + k])
    keepExtruders.push(mesh.extruders[t])
  }
  if (keep.length === 0) {
    throw new Error(`sliceMeshAboveZ: no triangles above z=${cutoffZ}; cutoff is too high`)
  }
  const positions = new Float32Array(keep)
  const triangleCount = positions.length / 9
  // Compute bbox + normals
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
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len
    for (const x of [ax, bx, cx]) { if (x < minX) minX = x; if (x > maxX) maxX = x }
    for (const y of [ay, by, cy]) { if (y < minY) minY = y; if (y > maxY) maxY = y }
    for (const z of [az, bz, cz]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z }
  }
  return {
    positions,
    normals,
    extruders: keepExtruders,
    triangleCount,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}

/** Apply scale (uniform) + translate to a mesh, returning a new BaseMesh. */
function transformMesh(mesh: BaseMesh, scale: number, tx: number, ty: number, tz: number): BaseMesh {
  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i]     = mesh.positions[i]     * scale + tx
    positions[i + 1] = mesh.positions[i + 1] * scale + ty
    positions[i + 2] = mesh.positions[i + 2] * scale + tz
  }
  return {
    positions,
    normals: mesh.normals,  // direction-preserving under uniform scale + translate
    extruders: mesh.extruders,
    triangleCount: mesh.triangleCount,
    bbox: {
      min: [mesh.bbox.min[0] * scale + tx, mesh.bbox.min[1] * scale + ty, mesh.bbox.min[2] * scale + tz],
      max: [mesh.bbox.max[0] * scale + tx, mesh.bbox.max[1] * scale + ty, mesh.bbox.max[2] * scale + tz],
      size: [mesh.bbox.size[0] * scale, mesh.bbox.size[1] * scale, mesh.bbox.size[2] * scale],
      center: [mesh.bbox.center[0] * scale + tx, mesh.bbox.center[1] * scale + ty, mesh.bbox.center[2] * scale + tz],
    },
  }
}

export async function headSwap(
  octopusBytes: Uint8Array,
  meshyBytes: Uint8Array,
  opts: HeadSwapOptions = {},
): Promise<{ bytes: Uint8Array; report: HeadSwapReport }> {
  const cutoffZ = opts.meshyHeadCutoffZ ?? 36
  const widthFactor = opts.headWidthFactor ?? 1.2
  const embedDepth = opts.embedDepthMm ?? 1.0

  // 1. Load both
  const octopus = await loadBaseMeshFromBytes(octopusBytes)
  const meshyOriginal = await loadBaseMeshFromBytes(meshyBytes)

  // 2. Decompose the OctoCustom — body = largest component
  const octoComponents = decompose(octopus)
  const bodyComp = octoComponents[0]
  const bodyTopZ = bodyComp.bbox.max[2]
  const bodyMaxXY = Math.max(bodyComp.bbox.size[0], bodyComp.bbox.size[1])

  // 3. Slice the Meshy to keep only the head/neck region
  const meshyHead = sliceMeshAboveZ(meshyOriginal, cutoffZ)
  // Center head XY at origin (drop x/y offset so head sits centered on the body)
  const headXYCentered = centerHeadXY(meshyHead)

  // 4. Compute target scale
  const headMaxXY = Math.max(headXYCentered.bbox.size[0], headXYCentered.bbox.size[1])
  const targetWidth = bodyMaxXY * widthFactor
  const scale = targetWidth / headMaxXY

  // 5. Translate so head bottom = bodyTopZ - embedDepth
  // After scale, the head's lowest z is headXYCentered.bbox.min[2] * scale
  const scaledHeadBottomZ = headXYCentered.bbox.min[2] * scale
  const tz = (bodyTopZ - embedDepth) - scaledHeadBottomZ
  const placedHead = transformMesh(headXYCentered, scale, 0, 0, tz)

  // 6. Build the output: every OctoCustom component as its own body + head
  const bodies: MeshBodyData[] = octoComponents.map((comp, i) => {
    const positions = new Float32Array(comp.triangleCount * 9)
    let off = 0
    for (const t of comp.triangleIndices) {
      positions.set(octopus.positions.subarray(t * 9, t * 9 + 9), off)
      off += 9
    }
    return {
      positions,
      extruder: 'A' as const,
      label: i === 0 ? 'Body' : `Tentacle segment ${i}`,
    }
  })
  bodies.push({
    positions: placedHead.positions,
    extruder: 'B' as const,  // head on different extruder for optional multi-color
    label: 'Head',
  })

  return {
    bytes: serialize3mf(bodies),
    report: {
      octopusComponentCount: octoComponents.length,
      headTriangleCount: placedHead.triangleCount,
      headBboxMm: placedHead.bbox.size as [number, number, number],
      headTranslateMm: [0, 0, tz],
      headScale: scale,
      octopusBodyBboxMm: bodyComp.bbox.size as [number, number, number],
    },
  }
}

/** Center a mesh in XY only (preserves z). */
function centerHeadXY(mesh: BaseMesh): BaseMesh {
  const cx = mesh.bbox.center[0]
  const cy = mesh.bbox.center[1]
  return transformMesh(mesh, 1, -cx, -cy, 0)
}
