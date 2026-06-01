import * as jscadModeling from '@jscad/modeling'
import { compileUserModule } from './sandbox'
import { serializeBinarySTL } from '@/lib/stl/serialize'
import type { MeshValidityReport } from '@/lib/mesh/validity'

export type JscadResult =
  | {
      ok: true
      positions: Float32Array
      bodies: { positions: Float32Array; extruder: 'A' | 'B'; label: string }[]
      triangleCount: number
      stl: Uint8Array
      /** Advisory manifold/watertight report. Attached by the worker after the
       * geometry is built (see worker-entry.ts). Optional so non-worker callers
       * of runJscad don't have to compute it. */
      validity?: MeshValidityReport
    }
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
    const floatPositions = new Float32Array(positions)
    return {
      ok: true,
      positions: floatPositions,
      bodies: [{
        positions: floatPositions,
        extruder: 'A',
        label: 'Body',
      }],
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
