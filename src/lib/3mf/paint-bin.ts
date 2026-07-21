/**
 * Compact mesh+labels format for interactive paint.
 * Avoids multi‑MB XML 3MF re-serialize on every brush click (was OOMing Node).
 *
 * Layout (little-endian):
 *   magic     4 bytes  "3DGP"
 *   version   u32      1
 *   triCount  u32
 *   positions Float32  × triCount × 9
 *   labels    u8       × triCount   (0 = A, 1 = B)
 */
import type { BaseMesh } from '@/lib/import/types'

const MAGIC = 0x50474433 // "3DGP" as little-endian u32... actually check bytes
// bytes: 0x33 0x44 0x47 0x50 = '3','D','G','P'

export function isPaintBin(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x33 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x47 &&
    bytes[3] === 0x50
  )
}

export function encodePaintBin(mesh: BaseMesh): Uint8Array {
  const n = mesh.triangleCount
  const header = 12
  const posBytes = n * 9 * 4
  const out = new Uint8Array(header + posBytes + n)
  const view = new DataView(out.buffer)
  out[0] = 0x33
  out[1] = 0x44
  out[2] = 0x47
  out[3] = 0x50
  view.setUint32(4, 1, true)
  view.setUint32(8, n, true)
  const posView = new Float32Array(out.buffer, header, n * 9)
  posView.set(mesh.positions.subarray(0, n * 9))
  const labOff = header + posBytes
  for (let i = 0; i < n; i++) {
    out[labOff + i] = mesh.extruders[i] === 'B' ? 1 : 0
  }
  return out
}

export function decodePaintBin(bytes: Uint8Array): BaseMesh {
  if (!isPaintBin(bytes)) throw new Error('not a paint-bin mesh')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)
  if (version !== 1) throw new Error(`unsupported paint-bin version ${version}`)
  const n = view.getUint32(8, true)
  const header = 12
  const posBytes = n * 9 * 4
  if (bytes.byteLength < header + posBytes + n) {
    throw new Error('paint-bin truncated')
  }
  // Copy positions so the Float32Array is 4-byte aligned and owned
  const posSrc = new Float32Array(
    bytes.buffer,
    bytes.byteOffset + header,
    n * 9,
  )
  const positions = new Float32Array(n * 9)
  positions.set(posSrc)
  const labels = bytes.subarray(header + posBytes, header + posBytes + n)
  const extruders: Array<'A' | 'B'> = new Array(n)
  for (let i = 0; i < n; i++) extruders[i] = labels[i] === 1 ? 'B' : 'A'

  // Normals + bbox
  const normals = new Float32Array(n * 3)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) {
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
    for (const x of [ax, bx, cx]) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    }
    for (const y of [ay, by, cy]) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (const z of [az, bz, cz]) {
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }

  return {
    positions,
    normals,
    extruders,
    triangleCount: n,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}

/** Split labeled mesh into viewer bodies A/B. */
export function meshToBodies(mesh: BaseMesh): Array<{
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}> {
  const counts = { A: 0, B: 0 }
  for (let i = 0; i < mesh.triangleCount; i++) counts[mesh.extruders[i]]++
  const out: Record<'A' | 'B', Float32Array> = {
    A: new Float32Array(counts.A * 9),
    B: new Float32Array(counts.B * 9),
  }
  const w = { A: 0, B: 0 }
  for (let i = 0; i < mesh.triangleCount; i++) {
    const ex = mesh.extruders[i]
    const o = i * 9
    const dest = out[ex]
    const d = w[ex]
    for (let j = 0; j < 9; j++) dest[d + j] = mesh.positions[o + j]
    w[ex] += 9
  }
  const bodies: Array<{ positions: Float32Array; extruder: 'A' | 'B'; label: string }> = []
  if (counts.A > 0) {
    bodies.push({ positions: out.A, extruder: 'A', label: 'Cor A (base)' })
  }
  if (counts.B > 0) {
    bodies.push({ positions: out.B, extruder: 'B', label: 'Cor B (destaque)' })
  }
  if (bodies.length === 0) {
    bodies.push({ positions: mesh.positions, extruder: 'A', label: 'Body' })
  }
  return bodies
}

/** Merge viewer bodies back into a single labeled mesh (for client paint). */
export function bodiesToMesh(
  bodies: Array<{ positions: Float32Array; extruder: 'A' | 'B' }>,
): BaseMesh {
  let total = 0
  for (const b of bodies) total += b.positions.length / 9
  const positions = new Float32Array(total * 9)
  const extruders: Array<'A' | 'B'> = new Array(total)
  let ti = 0
  let po = 0
  for (const b of bodies) {
    const n = b.positions.length / 9
    positions.set(b.positions, po)
    for (let i = 0; i < n; i++) extruders[ti + i] = b.extruder
    po += b.positions.length
    ti += n
  }
  const normals = new Float32Array(total * 3)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < total; i++) {
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
    for (const x of [ax, bx, cx]) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    }
    for (const y of [ay, by, cy]) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (const z of [az, bz, cz]) {
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  return {
    positions,
    normals,
    extruders,
    triangleCount: total,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}
