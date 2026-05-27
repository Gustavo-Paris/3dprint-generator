import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse3mf } from '@/lib/3mf/parse-3mf'
import type { BaseMesh } from './types'

const MAX_BYTES = 50 * 1024 * 1024

/** Load a .3mf from an absolute URL (http/https) or a project-local path
 *  (e.g. `/uploads/abc.3mf` served from `public/uploads/` in dev). */
export async function loadBaseMeshFromUrl(url: string): Promise<BaseMesh> {
  let buf: Uint8Array
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`)
    buf = new Uint8Array(await res.arrayBuffer())
  } else {
    // Local path served by Next from `public/`. Strip the leading `/` and
    // resolve relative to cwd's `public/` directory.
    const rel = url.startsWith('/') ? url.slice(1) : url
    buf = new Uint8Array(await readFile(join(process.cwd(), 'public', rel)))
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`3MF exceeds ${MAX_BYTES / 1024 / 1024}MB limit`)
  }
  return loadBaseMeshFromBytes(buf)
}

export async function loadBaseMeshFromBytes(bytes: Uint8Array): Promise<BaseMesh> {
  const bodies = parse3mf(bytes)
  if (bodies.length === 0) throw new Error('3MF contains no geometry')

  // Concatenate all bodies into one mesh, preserving extruder per triangle.
  let totalTris = 0
  for (const b of bodies) totalTris += b.positions.length / 9

  const positions = new Float32Array(totalTris * 9)
  const normals = new Float32Array(totalTris * 3)
  const extruders: Array<'A' | 'B'> = new Array(totalTris)

  let triOffset = 0
  let posOffset = 0
  for (const body of bodies) {
    const triCount = body.positions.length / 9
    positions.set(body.positions, posOffset)
    for (let i = 0; i < triCount; i++) extruders[triOffset + i] = body.extruder
    posOffset += body.positions.length
    triOffset += triCount
  }

  // Compute per-triangle normals + bbox in one pass.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < totalTris; i++) {
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
