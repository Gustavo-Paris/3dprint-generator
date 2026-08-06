import { readFile } from 'node:fs/promises'
import { resolveLocalAssetPath } from '@/lib/storage/local-asset'
import { parse3mf } from '@/lib/3mf/parse-3mf'
import { isPaintBin, decodePaintBin } from '@/lib/3mf/paint-bin'
import type { BaseMesh } from './types'

const MAX_BYTES = 50 * 1024 * 1024

/** Load a mesh (.3mf, paint-bin, or binary .stl) from an absolute URL or a
 *  project-local path (e.g. `/meshes/uuid.stl`, `/uploads/abc.3mf`). */
export async function loadBaseMeshFromUrl(url: string): Promise<BaseMesh> {
  let buf: Uint8Array
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`)
    buf = new Uint8Array(await res.arrayBuffer())
  } else {
    // Private store (+ legacy public/) — never assume static public/ serve.
    const filePath = await resolveLocalAssetPath(url)
    buf = new Uint8Array(await readFile(filePath))
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`Mesh exceeds ${MAX_BYTES / 1024 / 1024}MB limit`)
  }
  return loadBaseMeshFromBytes(buf)
}

/** Zip / 3MF magic. Binary STL never starts with these. */
function isZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/**
 * Heuristic for binary STL (Meshy freeform output). Length must match
 * header(80) + count(4) + 50×tri. Reject tiny buffers and ZIP/paint-bin.
 */
export function looksLikeBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84 || isZipMagic(bytes) || isPaintBin(bytes)) return false
  const triCount = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(80, true)
  if (triCount <= 0 || triCount > 20_000_000) return false
  return bytes.byteLength >= 84 + triCount * 50
}

function baseMeshFromPositions(
  positions: Float32Array,
  extruder: 'A' | 'B' = 'A',
): BaseMesh {
  const totalTris = positions.length / 9
  const normals = new Float32Array(totalTris * 3)
  const extruders: Array<'A' | 'B'> = new Array(totalTris)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < totalTris; i++) {
    extruders[i] = extruder
    const o = i * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az

    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len

    for (const x of [ax, bx, cx]) { if (x < minX) minX = x; if (x > maxX) maxX = x }
    for (const y of [ay, by, cy]) { if (y < minY) minY = y; if (y > maxY) maxY = y }
    for (const z of [az, bz, cz]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z }
  }

  return {
    positions, normals, extruders,
    triangleCount: totalTris,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}

export async function loadBaseMeshFromBytes(bytes: Uint8Array): Promise<BaseMesh> {
  // Interactive paint format (no 3MF XML)
  if (isPaintBin(bytes)) return decodePaintBin(bytes)

  // Freeform (Meshy) persists binary STL — accept it so logo/paint-from-server
  // paths can use freeform meshes as an imported-style base (rm-009).
  if (looksLikeBinaryStl(bytes)) {
    const { parseBinarySTL } = await import('@/lib/jscad/runner')
    const positions = parseBinarySTL(bytes)
    if (positions.length < 9) throw new Error('STL contains no geometry')
    return baseMeshFromPositions(positions)
  }

  if (!isZipMagic(bytes)) {
    throw new Error('Unrecognized mesh format (expected 3MF, paint-bin, or binary STL)')
  }

  const bodies = parse3mf(bytes)
  if (bodies.length === 0) throw new Error('3MF contains no geometry')

  // Concatenate all bodies into one mesh, preserving extruder per triangle.
  let totalTris = 0
  for (const b of bodies) totalTris += b.positions.length / 9

  const positions = new Float32Array(totalTris * 9)
  let posOffset = 0
  const extruders: Array<'A' | 'B'> = new Array(totalTris)
  let triOffset = 0
  for (const body of bodies) {
    const triCount = body.positions.length / 9
    positions.set(body.positions, posOffset)
    for (let i = 0; i < triCount; i++) extruders[triOffset + i] = body.extruder
    posOffset += body.positions.length
    triOffset += triCount
  }

  const mesh = baseMeshFromPositions(positions)
  // Preserve multi-body extruder labels from 3MF bodies.
  mesh.extruders = extruders
  return mesh
}
