/**
 * Read a request body enforcing a hard byte ceiling that does NOT trust the
 * Content-Length header.
 *
 * `Number(null) = 0` made a header-only check bypassable: a request with
 * `Transfer-Encoding: chunked` carries no Content-Length, so `req.json()`
 * would buffer an arbitrarily large body (Next route handlers impose no body
 * limit) — a single-request OOM DoS. Here the stream is consumed chunk by
 * chunk and cancelled the moment the running total crosses `maxBytes`, so at
 * most ~maxBytes ever materializes in memory.
 *
 * Returns `null` when the cap is exceeded (caller maps that to 413).
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Buffer | null> {
  // Fast path: an honest oversized Content-Length is rejected without reading.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null

  if (!req.body) {
    const buf = Buffer.from(await req.arrayBuffer())
    return buf.byteLength > maxBytes ? null : buf
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
