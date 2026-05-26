import { runJscad, parseBinarySTL } from './runner'
import type { JscadResult } from './runner'
import { parse3mf } from '@/lib/3mf/parse-3mf'

type Input =
  | { type: 'jscad'; code: string }
  | { type: 'stl'; stl: Uint8Array }

self.onmessage = async (e: MessageEvent<Input>) => {
  const msg = e.data
  if (msg.type === 'jscad') {
    const result = await runJscad(msg.code)
    ;(self as unknown as Worker).postMessage(result)
    return
  }
  if (msg.type === 'stl') {
    try {
      const bytes = msg.stl
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
        ;(self as unknown as Worker).postMessage(result)
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
        ;(self as unknown as Worker).postMessage(result)
      }
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ ok: false, error: String(err) })
    }
  }
}
