import { runJscad } from './runner'

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const result = await runJscad(e.data.code)
  ;(self as unknown as Worker).postMessage(result)
}
