import * as jscadModeling from '@jscad/modeling'
import { compileUserModule } from './sandbox'

export type JscadResult =
  | { ok: true; positions: Float32Array; triangleCount: number; stl: Uint8Array }
  | { ok: false; error: string }

export async function runJscad(code: string): Promise<JscadResult> {
  let mod: { main?: () => unknown }
  try {
    const factory = compileUserModule(code)
    mod = factory(jscadModeling)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  if (typeof mod?.main !== 'function') {
    return {
      ok: false,
      error: 'Code must export a main() function via module.exports = { main }.',
    }
  }

  let geom: unknown
  try {
    geom = mod.main()
  } catch (e) {
    return { ok: false, error: `main() threw: ${(e as Error).message}` }
  }

  try {
    const { toPolygons } = jscadModeling.geometries.geom3
    const polygons = toPolygons(geom as Parameters<typeof toPolygons>[0])
    if (!Array.isArray(polygons) || polygons.length === 0) {
      return { ok: false, error: 'main() returned no geometry.' }
    }

    const positions: number[] = []
    for (const poly of polygons) {
      const verts = poly.vertices
      for (let i = 1; i < verts.length - 1; i++) {
        positions.push(...verts[0], ...verts[i], ...verts[i + 1])
      }
    }
    const stl = serializeBinarySTL(positions)
    return {
      ok: true,
      positions: new Float32Array(positions),
      triangleCount: positions.length / 9,
      stl,
    }
  } catch (e) {
    return {
      ok: false,
      error: `main() did not return a 3D geometry (geom3). ${(e as Error).message}`,
    }
  }
}

export function parseBinarySTL(stl: Uint8Array): Float32Array {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const triCount = dv.getUint32(80, true)
  const positions = new Float32Array(triCount * 9)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(base + 12 + v * 4, true)
    }
  }
  return positions
}

function serializeBinarySTL(positions: number[]): Uint8Array {
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
