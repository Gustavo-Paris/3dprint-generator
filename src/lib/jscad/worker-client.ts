import type { JscadResult } from './runner'

type Job = { resolve: (r: JscadResult) => void; reject: (e: unknown) => void }

let worker: Worker | null = null
let pending: Job | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<JscadResult>) => {
    pending?.resolve(e.data)
    pending = null
  }
  worker.onerror = (e) => {
    pending?.reject(e)
    pending = null
    worker?.terminate()
    worker = null
  }
  return worker
}

export function runInWorker(code: string): Promise<JscadResult> {
  if (pending) return Promise.reject(new Error('Another job is in flight'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    ensureWorker().postMessage({ code })
  })
}
