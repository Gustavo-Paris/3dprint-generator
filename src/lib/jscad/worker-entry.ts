import { runJscad, parseBinarySTL } from './runner'
import type { JscadResult } from './runner'

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
      const positions = parseBinarySTL(msg.stl)
      const result: JscadResult = {
        ok: true,
        positions,
        triangleCount: positions.length / 9,
        stl: msg.stl,
      }
      ;(self as unknown as Worker).postMessage(result)
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ ok: false, error: String(err) })
    }
  }
}
