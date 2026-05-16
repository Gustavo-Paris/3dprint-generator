/**
 * Serialize a flat array of vertex positions (9 numbers per triangle: v0x,v0y,v0z, v1x,v1y,v1z, v2x,v2y,v2z)
 * into a watertight binary STL buffer.
 */
export function serializeBinarySTL(positions: number[]): Uint8Array {
  const triCount = positions.length / 9
  const buf = new ArrayBuffer(84 + 50 * triCount)
  const dv = new DataView(buf)
  // Bytes 0–79: header (zeroed) — leave as 0
  dv.setUint32(80, triCount, true)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    const o = i * 9
    const ax = positions[o + 3] - positions[o]
    const ay = positions[o + 4] - positions[o + 1]
    const az = positions[o + 5] - positions[o + 2]
    const bx = positions[o + 6] - positions[o]
    const by = positions[o + 7] - positions[o + 1]
    const bz = positions[o + 8] - positions[o + 2]
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    dv.setFloat32(base, nx, true)
    dv.setFloat32(base + 4, ny, true)
    dv.setFloat32(base + 8, nz, true)
    for (let v = 0; v < 9; v++) {
      dv.setFloat32(base + 12 + v * 4, positions[o + v], true)
    }
    dv.setUint16(base + 48, 0, true)
  }
  return new Uint8Array(buf)
}
