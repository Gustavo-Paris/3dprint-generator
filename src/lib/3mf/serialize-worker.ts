/**
 * Web Worker: multi-colour 3MF serialization (weld + XML + zip) off the main
 * thread. Exporting a painted 700k-tri mesh was freezing the UI ~4s when
 * `serialize3mf` ran inline in the click handler.
 *
 * Same spawn/transfer structure as src/lib/paint/paint-worker.ts.
 */
import { serialize3mf, type MeshBodyData, type Serialize3mfOptions } from './serialize-3mf'

export type SerializeWorkerIn = {
  bodies: MeshBodyData[]
  opts?: Serialize3mfOptions
  /** Correlates a job with its response so overlapping calls on the shared
   *  worker never resolve each other's promise. Echoed verbatim in the reply. */
  reqId?: number
}

export type SerializeWorkerOut =
  | { ok: true; bytes: Uint8Array; reqId?: number }
  | { ok: false; error: string; reqId?: number }

/** Handshake: posted by the worker once its message handler is attached. */
export type SerializeWorkerReady = { type: 'ready' }

/** Pure message handler — exported so the node test suite can exercise it
 *  without a real Worker (workers don't exist in the vitest node env). */
export function handleSerializeMessage(msg: SerializeWorkerIn): SerializeWorkerOut {
  try {
    return { ok: true, bytes: serialize3mf(msg.bodies, msg.opts) }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// Only attach in a real worker scope — this module is also imported by the
// wrapper's tests under node, where WorkerGlobalScope is undefined. Do NOT
// gate on `typeof window === 'undefined'`: turbopack's dev worker runtime
// defines a `window` alias inside workers, which silently skipped this block —
// the handler never attached, every job vanished and the export hung forever.
const WorkerScope = (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope
if (
  typeof self !== 'undefined' &&
  typeof WorkerScope === 'function' &&
  self instanceof (WorkerScope as new () => object)
) {
  self.onmessage = (e: MessageEvent<SerializeWorkerIn>) => {
    const out = { ...handleSerializeMessage(e.data), reqId: e.data.reqId }
    if (out.ok) {
      ;(self as unknown as Worker).postMessage(out, [out.bytes.buffer as ArrayBuffer])
    } else {
      ;(self as unknown as Worker).postMessage(out)
    }
  }
  // Handshake: dev bundlers (turbopack) evaluate worker modules asynchronously
  // behind a wrapper script, so a job posted right after `new Worker(...)` can
  // be dispatched before this module attached `onmessage` — and silently
  // dropped (export button hung forever, no error). The wrapper only posts the
  // job after receiving this ready signal.
  ;(self as unknown as Worker).postMessage({ type: 'ready' } satisfies SerializeWorkerReady)
}
