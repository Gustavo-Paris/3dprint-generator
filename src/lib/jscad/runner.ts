import * as jscadModeling from '@jscad/modeling'
import { compileUserModule } from './sandbox'

export type JscadResult =
  | { ok: true; positions: Float32Array; triangleCount: number }
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
    return {
      ok: true,
      positions: new Float32Array(positions),
      triangleCount: positions.length / 9,
    }
  } catch (e) {
    return {
      ok: false,
      error: `main() did not return a 3D geometry (geom3). ${(e as Error).message}`,
    }
  }
}
