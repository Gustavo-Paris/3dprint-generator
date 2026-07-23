/**
 * Unit tests: readBodyCapped — the streaming body ceiling used by
 * POST /api/paint-save.
 *
 * The old guard trusted Content-Length only (`Number(null) = 0` for chunked
 * transfer), so `req.json()` could buffer an unbounded body. These tests prove
 * the cap counts actual wire bytes and cancels the source stream early.
 */
import { describe, it, expect } from 'vitest'
import { readBodyCapped } from '@/lib/http/read-body-capped'

const enc = new TextEncoder()

function chunkedRequest(stream: ReadableStream<Uint8Array>): Request {
  // A stream body has NO Content-Length (the chunked-transfer shape).
  return new Request('http://localhost/api/paint-save', {
    method: 'POST',
    body: stream,
    // Node/undici requires half-duplex for stream bodies.
    duplex: 'half',
  } as RequestInit)
}

describe('readBodyCapped', () => {
  it('returns the full body for an under-cap chunked request without Content-Length', async () => {
    const payload = JSON.stringify({ hello: 'world', n: 42 })
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // Two chunks to exercise concatenation.
        c.enqueue(enc.encode(payload.slice(0, 5)))
        c.enqueue(enc.encode(payload.slice(5)))
        c.close()
      },
    })
    const req = chunkedRequest(stream)
    expect(req.headers.get('content-length')).toBeNull() // precondition: chunked
    const buf = await readBodyCapped(req, 1024)
    expect(buf).not.toBeNull()
    expect(buf!.toString('utf8')).toBe(payload)
  })

  it('accepts a body of exactly maxBytes', async () => {
    const body = 'x'.repeat(100)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(body))
        c.close()
      },
    })
    const buf = await readBodyCapped(chunkedRequest(stream), 100)
    expect(buf).not.toBeNull()
    expect(buf!.byteLength).toBe(100)
  })

  it('returns null AND stops pulling once a chunked stream crosses the cap', async () => {
    // Pull-based source that could produce 1MB total in 100-byte chunks; the
    // reader must cancel long before that.
    let pulls = 0
    const chunk = new Uint8Array(100)
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++
        if (pulls > 10_000) c.close()
        else c.enqueue(chunk)
      },
    })
    const buf = await readBodyCapped(chunkedRequest(stream), 1000)
    expect(buf).toBeNull()
    // Cap = 1000 → crossed on the ~11th chunk. Cancellation must have stopped
    // the pump: nowhere near the 10k pulls of the full body.
    expect(pulls).toBeLessThan(50)
  })

  it('rejects a declared oversized Content-Length without reading the stream', async () => {
    const req = new Request('http://localhost/api/paint-save', {
      method: 'POST',
      headers: { 'content-length': String(200) },
      body: 'small',
    })
    const buf = await readBodyCapped(req, 100)
    expect(buf).toBeNull()
  })

  it('still caps a lying under-declared Content-Length by actual bytes', async () => {
    // Header says 10 bytes, stream delivers 500 — actual bytes must win.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(500))
        c.close()
      },
    })
    const req = new Request('http://localhost/api/paint-save', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const buf = await readBodyCapped(req, 100)
    expect(buf).toBeNull()
  })
})
