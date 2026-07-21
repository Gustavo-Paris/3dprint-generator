/**
 * Web Worker: flood-fill / brush off the main thread.
 * Interactive paint never hits the Next.js server (avoids OOM on 1M+ tri meshes).
 */
import { applyPaintBrush } from '../import/ops/paint-brush'
import type { BaseMesh } from '../import/types'

export type PaintWorkerIn = {
  positions: Float32Array
  normals: Float32Array
  /** 0 = A, 1 = B */
  labels: Uint8Array
  triangleCount: number
  bbox: BaseMesh['bbox']
  point: [number, number, number]
  extruder: 'A' | 'B'
  mode: 'fill' | 'radius'
  radiusMm: number
  featureAngleDeg: number
}

export type PaintWorkerOut =
  | { ok: true; labels: Uint8Array }
  | { ok: false; error: string }

self.onmessage = async (e: MessageEvent<PaintWorkerIn>) => {
  try {
    const msg = e.data
    const extruders: Array<'A' | 'B'> = new Array(msg.triangleCount)
    for (let i = 0; i < msg.triangleCount; i++) {
      extruders[i] = msg.labels[i] === 1 ? 'B' : 'A'
    }
    const mesh: BaseMesh = {
      positions: msg.positions,
      normals: msg.normals,
      extruders,
      triangleCount: msg.triangleCount,
      bbox: msg.bbox,
    }
    const painted = await applyPaintBrush(
      mesh,
      {
        op: 'paint_brush',
        point: msg.point,
        extruder: msg.extruder,
        mode: msg.mode,
        radiusMm: msg.radiusMm,
        featureAngleDeg: msg.featureAngleDeg,
      },
      [],
    )
    const labels = new Uint8Array(msg.triangleCount)
    for (let i = 0; i < msg.triangleCount; i++) {
      labels[i] = painted.extruders[i] === 'B' ? 1 : 0
    }
    const out: PaintWorkerOut = { ok: true, labels }
    ;(self as unknown as Worker).postMessage(out, [labels.buffer])
  } catch (err) {
    const out: PaintWorkerOut = { ok: false, error: String(err) }
    ;(self as unknown as Worker).postMessage(out)
  }
}
