import type { BaseMesh } from '@/lib/import/types'
import type { PaintWorkerIn, PaintWorkerOut } from './paint-worker'

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./paint-worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

/** Run paint off main thread. Does not touch the network. */
export function runPaintInWorker(input: {
  mesh: BaseMesh
  point: [number, number, number]
  extruder: 'A' | 'B'
  mode: 'fill' | 'radius'
  radiusMm: number
  featureAngleDeg?: number
}): Promise<BaseMesh> {
  const labels = new Uint8Array(input.mesh.triangleCount)
  for (let i = 0; i < input.mesh.triangleCount; i++) {
    labels[i] = input.mesh.extruders[i] === 'B' ? 1 : 0
  }

  const msg: PaintWorkerIn = {
    positions: input.mesh.positions,
    normals: input.mesh.normals,
    labels,
    triangleCount: input.mesh.triangleCount,
    bbox: input.mesh.bbox,
    point: input.point,
    extruder: input.extruder,
    mode: input.mode,
    radiusMm: input.radiusMm,
    featureAngleDeg: input.featureAngleDeg ?? 38,
  }

  return new Promise((resolve, reject) => {
    const w = getWorker()
    const onMsg = (e: MessageEvent<PaintWorkerOut>) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      if (!e.data.ok) {
        reject(new Error(e.data.error))
        return
      }
      const extruders: Array<'A' | 'B'> = new Array(input.mesh.triangleCount)
      for (let i = 0; i < input.mesh.triangleCount; i++) {
        extruders[i] = e.data.labels[i] === 1 ? 'B' : 'A'
      }
      resolve({
        ...input.mesh,
        extruders,
      })
    }
    const onErr = (err: ErrorEvent) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      reject(err.error ?? new Error(err.message))
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', onErr)
    // Transfer labels buffer; positions/normals are copied (shared would detach from main)
    w.postMessage(msg, [labels.buffer])
  })
}
