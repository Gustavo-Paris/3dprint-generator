/**
 * jscad_raw op — execute LLM-authored JSCAD code in the existing sandbox.
 *
 * Timeout limitation:
 *   Node.js has no preemption mechanism for synchronous user code.
 *   A tight `while(true) {}` loop WILL block the event loop and the
 *   setTimeout-based timeout will never fire.
 *
 * TODO (Phase 5): move execution into a Worker thread (`worker_threads`)
 * so the main thread can forcibly terminate it after timeoutMs. This is
 * the only reliable way to handle synchronous infinite loops in Node.
 */

import type { Geom3 } from '@jscad/modeling/src/geometries/types'
import type { Op } from '@/lib/design/schema'
import type { BaseMesh } from '../types'
import { compileUserModule } from '@/lib/jscad/sandbox'
import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'

type JscadRawParams = Extract<Op, { op: 'jscad_raw' }>

const DEFAULT_TIMEOUT = 30_000

export async function applyJscadRaw(
  mesh: BaseMesh,
  op: JscadRawParams,
  options: { timeoutMs?: number } = {},
): Promise<BaseMesh> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const jscad = await import('@jscad/modeling')

  const factory = compileUserModule(op.code)
  const userMod = factory(jscad)
  if (typeof userMod?.main !== 'function') {
    throw new Error(`jscad_raw: code must export main() via module.exports = { main }`)
  }

  const main = userMod.main as (current?: unknown) => unknown
  const currentGeom = op.mode === 'replace' ? await baseMeshToGeom3(mesh) : undefined

  // NOTE: runWithTimeout wraps execution in a race between the actual call
  // and a setTimeout rejection. This works reliably for async user code or
  // synchronous code that yields (awaits). For a tight synchronous loop the
  // setTimeout callback queues but never runs because the event loop is
  // blocked — see the TODO above.
  const userGeom = await runWithTimeout(() => main(currentGeom), timeoutMs) as Geom3

  if (op.mode === 'replace') {
    return geom3ToBaseMesh(userGeom, mesh.extruders[0] ?? 'A')
  }

  // union mode — boolean union of current mesh + user-returned geometry
  const base = await baseMeshToGeom3(mesh) as Geom3
  const result = jscad.booleans.union(base, userGeom)
  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}

function runWithTimeout<T>(fn: () => T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`jscad_raw timeout after ${ms}ms`)),
      ms,
    )
    queueMicrotask(() => {
      try {
        const result = fn()
        clearTimeout(timer)
        resolve(result)
      } catch (e) {
        clearTimeout(timer)
        reject(e)
      }
    })
  })
}
