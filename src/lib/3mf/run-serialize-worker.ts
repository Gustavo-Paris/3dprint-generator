import { serialize3mf, type MeshBodyData, type Serialize3mfOptions } from './serialize-3mf'
import type { SerializeWorkerIn, SerializeWorkerOut, SerializeWorkerReady } from './serialize-worker'

let worker: Worker | null = null
let workerReady: Promise<void> | null = null
let nextReqId = 1

/**
 * If the worker hasn't signalled ready within this window, assume it will
 * never respond (e.g. a bundler wrapper that failed silently) and serialize on
 * the main thread instead. A frozen tab for a few seconds beats an export
 * button that stays disabled forever with no download and no error.
 */
const READY_TIMEOUT_MS = 10_000

/**
 * Spawn (or reuse) the serialize worker plus a promise that resolves once the
 * worker posted its `{ type: 'ready' }` handshake. Jobs must only be posted
 * after that: dev bundlers (turbopack) evaluate the worker module
 * asynchronously behind a wrapper script, so a message posted immediately
 * after `new Worker(...)` can be dispatched before the module attaches
 * `onmessage` — and is silently dropped (the export hung forever).
 */
function getWorker(): { w: Worker; ready: Promise<void> } {
  if (!worker) {
    const w = new Worker(new URL('./serialize-worker.ts', import.meta.url), { type: 'module' })
    workerReady = new Promise<void>((resolve) => {
      const onReady = (e: MessageEvent<SerializeWorkerOut | SerializeWorkerReady>) => {
        if (e.data && typeof e.data === 'object' && 'type' in e.data && e.data.type === 'ready') {
          w.removeEventListener('message', onReady)
          resolve()
        }
      }
      w.addEventListener('message', onReady)
    })
    worker = w
  }
  return { w: worker, ready: workerReady! }
}

/** Terminate the singleton so the next call spawns a fresh worker. */
function resetWorker(): void {
  try {
    worker?.terminate()
  } catch {
    // best effort
  }
  worker = null
  workerReady = null
}

/**
 * Serialize a multi-colour 3MF off the main thread. Does not touch the network.
 *
 * OWNERSHIP: each body's `positions` buffer is TRANSFERRED to the worker (not
 * copied — that would double the ~25MB soup on the main thread), so callers
 * must treat `bodies` as consumed after this call. `meshToBodies` /
 * `plan.apply` outputs are freshly allocated, which makes the export flow safe;
 * never pass a buffer you still need (e.g. `paintMeshRef`'s own positions).
 * The transfer only happens after the worker's ready handshake, so the
 * sync fallback below still sees intact buffers.
 *
 * Falls back to the synchronous `serialize3mf` when `Worker` is unavailable
 * (SSR, vitest node env) or when the worker never becomes ready.
 */
export function runSerialize3mfInWorker(
  bodies: MeshBodyData[],
  opts?: Serialize3mfOptions,
): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') {
    try {
      return Promise.resolve(serialize3mf(bodies, opts))
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const reqId = nextReqId++
  const msg: SerializeWorkerIn = { bodies, opts, reqId }
  // Dedupe: listing the same ArrayBuffer twice (possible via paint-bin's
  // empty-mesh fallback body) throws a DataCloneError on postMessage.
  const transfers = [...new Set(bodies.map((b) => b.positions.buffer as ArrayBuffer))]

  return new Promise((resolve, reject) => {
    const { w, ready } = getWorker()
    let settled = false
    let readyTimer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      if (readyTimer !== null) clearTimeout(readyTimer)
    }
    const onMsg = (e: MessageEvent<SerializeWorkerOut | SerializeWorkerReady>) => {
      const data = e.data
      // Ignore the handshake — only job results settle this promise.
      if ('type' in data) return
      // Correlate: the shared worker fans every reply to all in-flight
      // listeners; only settle on THIS job's response (older workers without
      // reqId echo undefined — accept for back-compat when a single call).
      if (data.reqId !== undefined && data.reqId !== reqId) return
      if (settled) return
      settled = true
      cleanup()
      if (data.ok) resolve(data.bytes)
      else reject(new Error(data.error))
    }
    const onErr = (err: ErrorEvent) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err.error ?? new Error(err.message))
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', onErr)

    // Safety net: never leave the caller hanging forever. Buffers were not
    // transferred yet, so the main-thread serializer still owns them.
    readyTimer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resetWorker()
      try {
        resolve(serialize3mf(bodies, opts))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }, READY_TIMEOUT_MS)

    ready.then(() => {
      if (settled) return
      // Serialization itself may legitimately take longer than the handshake
      // window — the timeout only guards the ready phase.
      if (readyTimer !== null) {
        clearTimeout(readyTimer)
        readyTimer = null
      }
      w.postMessage(msg, transfers)
    })
  })
}
