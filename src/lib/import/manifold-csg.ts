/**
 * Volumetric CSG on raw triangle soups, backed by Manifold (WASM).
 *
 * Why this exists: JSCAD's BSP boolean path OOMs past ~50k triangles (see
 * BOOLEAN_TRIANGLE_LIMIT in apply-edits.ts). Real imported .3mf models are
 * routinely 500k–2M triangles. Manifold is built for exactly this — guaranteed
 * manifold output, boolean on meshes with millions of triangles.
 *
 * Constraint: the base must be a closed 2-manifold solid. Welding duplicated
 * vertices (mergeVertices) repairs the common "phantom boundary edge" case, but
 * genuine holes make Manifold reject the input — we surface that as an Error the
 * caller turns into a user-facing warning rather than producing garbage.
 */
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ManifoldToplevel, Manifold } from 'manifold-3d'

let wasmPromise: Promise<ManifoldToplevel> | null = null

/** Load + memoise the WASM module once per process (init is heavy). */
async function getWasm(): Promise<ManifoldToplevel> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const Module = (await import('manifold-3d')).default
      const wasm = await Module()
      wasm.setup()
      return wasm
    })()
  }
  return wasmPromise
}

/** Free an emscripten-bound object; `delete` isn't on the public TS type. */
function free(obj: unknown): void {
  ;(obj as { delete?: () => void } | undefined)?.delete?.()
}

/**
 * Weld a triangle-soup Float32Array (9 floats / triangle, flat xyz) into the
 * indexed buffers Manifold needs. Welding doubles as a light repair: it
 * collapses coincident vertices that would otherwise read as boundary edges.
 */
function soupToIndexed(
  positions: Float32Array,
  tol = 1e-4,
): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
  const merged = mergeVertices(geo, tol)
  const posAttr = merged.getAttribute('position')
  const indexAttr = merged.getIndex()
  if (!indexAttr) throw new Error('mergeVertices returned no index buffer')
  return {
    vertProperties: Float32Array.from(posAttr.array as ArrayLike<number>),
    triVerts: Uint32Array.from(indexAttr.array as ArrayLike<number>),
  }
}

function soupToManifold(wasm: ManifoldToplevel, positions: Float32Array): Manifold {
  const { vertProperties, triVerts } = soupToIndexed(positions)
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts })
  return new wasm.Manifold(mesh)
}

/** Flatten a Manifold result back to a triangle soup (9 floats / triangle). */
function manifoldToSoup(m: Manifold): Float32Array {
  const mesh = m.getMesh()
  const { vertProperties, triVerts, numProp } = mesh
  const out = new Float32Array(triVerts.length * 3)
  for (let i = 0; i < triVerts.length; i++) {
    const base = triVerts[i] * numProp
    out[i * 3] = vertProperties[base]
    out[i * 3 + 1] = vertProperties[base + 1]
    out[i * 3 + 2] = vertProperties[base + 2]
  }
  return out
}

export type ManifoldBoolean = 'subtract' | 'union' | 'intersect'

/**
 * Run a boolean of `tool` against `base` (both raw triangle soups) and return
 * the result as a triangle soup. `base` must be a closed manifold solid.
 *
 * @throws if `base` welds to a non-manifold surface, or the boolean yields an
 *         empty result (e.g. the tool never touches the surface).
 */
export async function booleanSoup(
  basePositions: Float32Array,
  toolPositions: Float32Array,
  op: ManifoldBoolean,
): Promise<Float32Array> {
  const wasm = await getWasm()
  let base: Manifold | undefined
  let tool: Manifold | undefined
  let result: Manifold | undefined
  try {
    base = soupToManifold(wasm, basePositions)
    if (base.isEmpty()) {
      throw new Error(
        'base mesh is not a closed manifold (not watertight) — this edit needs a watertight solid',
      )
    }
    tool = soupToManifold(wasm, toolPositions)
    result =
      op === 'subtract' ? base.subtract(tool)
      : op === 'union' ? base.add(tool)
      : base.intersect(tool)
    if (result.isEmpty()) {
      throw new Error('boolean produced an empty result (the logo may not intersect the chosen face)')
    }
    return manifoldToSoup(result)
  } finally {
    free(result)
    free(tool)
    free(base)
  }
}
