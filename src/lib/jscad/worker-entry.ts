import { runJscad, parseBinarySTL } from './runner'
import type { JscadResult } from './runner'
import { parse3mf } from '@/lib/3mf/parse-3mf'
import { analyzeMeshValidity } from '@/lib/mesh/validity'

type Input =
  | { type: 'jscad'; code: string }
  | { type: 'stl'; stl: Uint8Array }

/** Single exit point: attach the advisory validity report (computed once, off
 * the main thread) to every successful result, then post it. */
function reply(result: JscadResult): void {
  if (result.ok) result.validity = analyzeMeshValidity(result.positions)
  ;(self as unknown as Worker).postMessage(result)
}

self.onmessage = async (e: MessageEvent<Input>) => {
  const msg = e.data
  if (msg.type === 'jscad') {
    reply(await runJscad(msg.code))
    return
  }
  if (msg.type === 'stl') {
    try {
      const bytes = msg.stl
      // Paint-bin (interactive multi-colour) — "3DGP"
      if (bytes[0] === 0x33 && bytes[1] === 0x44 && bytes[2] === 0x47 && bytes[3] === 0x50) {
        const { decodePaintBin, meshToBodies } = await import('@/lib/3mf/paint-bin')
        const mesh = decodePaintBin(bytes)
        const bodies = meshToBodies(mesh)
        const result: JscadResult = {
          ok: true,
          positions: mesh.positions,
          bodies,
          triangleCount: mesh.triangleCount,
          stl: bytes,
        }
        reply(result)
        return
      }
      const is3mf = bytes[0] === 0x50 && bytes[1] === 0x4b
      if (is3mf) {
        const bodies = parse3mf(bytes)
        const totalLength = bodies.reduce((sum, b) => sum + b.positions.length, 0)
        const mergedPositions = new Float32Array(totalLength)
        let offset = 0
        for (const b of bodies) {
          mergedPositions.set(b.positions, offset)
          offset += b.positions.length
        }
        const result: JscadResult = {
          ok: true,
          positions: mergedPositions,
          bodies,
          triangleCount: mergedPositions.length / 9,
          stl: bytes,
        }
        reply(result)
      } else {
        const positions = parseBinarySTL(bytes)
        const result: JscadResult = {
          ok: true,
          positions,
          bodies: [{
            positions,
            extruder: 'A',
            label: 'Body',
          }],
          triangleCount: positions.length / 9,
          stl: bytes,
        }
        reply(result)
      }
    } catch (err) {
      reply({ ok: false, error: String(err) })
    }
  }
}
