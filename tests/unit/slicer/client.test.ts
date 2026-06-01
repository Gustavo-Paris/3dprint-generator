import { describe, it, expect, vi } from 'vitest'
import { checkSlicerHealth, sliceStl, SlicerError } from '@/lib/slicer/client'

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
const fetchOf = (impl: () => Promise<Response>) =>
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(impl) as unknown as typeof fetch

describe('checkSlicerHealth', () => {
  it('reports ok and maps fields when the slicer is healthy', async () => {
    const h = await checkSlicerHealth({
      fetchImpl: fetchOf(async () => json({ ok: true, orca: '/opt/orca/AppRun', profiles_dir: '/app/profiles' })),
    })
    expect(h).toEqual({ ok: true, orca: '/opt/orca/AppRun', profilesDir: '/app/profiles' })
  })

  it('reports not-ok on a bad HTTP status (never throws)', async () => {
    const h = await checkSlicerHealth({ fetchImpl: fetchOf(async () => json({}, 503)) })
    expect(h.ok).toBe(false)
    expect(h.error).toMatch(/503/)
  })

  it('classifies a connection failure as offline (never throws)', async () => {
    const h = await checkSlicerHealth({
      fetchImpl: fetchOf(async () => { throw new TypeError('fetch failed') }),
    })
    expect(h.ok).toBe(false)
    expect(h.error).toMatch(/offline/i)
  })

  it('classifies an abort as timeout (never throws)', async () => {
    const h = await checkSlicerHealth({ fetchImpl: fetchOf(async () => { throw abortError() }) })
    expect(h.ok).toBe(false)
    expect(h.error).toMatch(/timeout/i)
  })

  it('reports not-ok when the slicer answers 200 but body.ok is false', async () => {
    const h = await checkSlicerHealth({ fetchImpl: fetchOf(async () => json({ ok: false })) })
    expect(h.ok).toBe(false)
    expect(h.error).toMatch(/not ok/i)
  })
})

describe('sliceStl', () => {
  const stl = new Uint8Array([1, 2, 3])

  it('returns bytes + meta on success', async () => {
    const r = await sliceStl(stl, {
      fetchImpl: fetchOf(async () =>
        json({ bytes_base64: Buffer.from([9, 8, 7]).toString('base64'), meta: { print_time_min: 42, filament_g: 3.5 } }),
      ),
    })
    expect(Array.from(r.bytes)).toEqual([9, 8, 7])
    expect(r.meta).toEqual({ print_time_min: 42, filament_g: 3.5 })
  })

  it('throws SlicerError kind="slicer" with status on a non-ok response', async () => {
    const err = await sliceStl(stl, { fetchImpl: fetchOf(async () => new Response('boom', { status: 500 })) })
      .then(() => null, (e) => e as SlicerError)
    expect(err).toBeInstanceOf(SlicerError)
    expect(err?.kind).toBe('slicer')
    expect(err?.status).toBe(500)
  })

  it('throws SlicerError kind="offline" when the slicer is unreachable', async () => {
    const err = await sliceStl(stl, { fetchImpl: fetchOf(async () => { throw new TypeError('fetch failed') }) })
      .then(() => null, (e) => e as SlicerError)
    expect(err).toBeInstanceOf(SlicerError)
    expect(err?.kind).toBe('offline')
  })

  it('throws SlicerError kind="timeout" on abort', async () => {
    const err = await sliceStl(stl, { fetchImpl: fetchOf(async () => { throw abortError() }) })
      .then(() => null, (e) => e as SlicerError)
    expect(err).toBeInstanceOf(SlicerError)
    expect(err?.kind).toBe('timeout')
  })

  it('classifies an abort DURING the body read as timeout (slow/hung 3MF stream)', async () => {
    // 200 + headers, then the body stream aborts mid-parse — the case the
    // timeout exists for. Must still become SlicerError kind="timeout" (→ 503),
    // not escape raw (→ 502).
    const bodyAborts = { ok: true, json: async () => { throw abortError() } } as unknown as Response
    const err = await sliceStl(stl, { fetchImpl: fetchOf(async () => bodyAborts) })
      .then(() => null, (e) => e as SlicerError)
    expect(err).toBeInstanceOf(SlicerError)
    expect(err?.kind).toBe('timeout')
  })

  it('classifies a malformed (non-JSON) 200 body as a SlicerError (offline), not a raw throw', async () => {
    const badBody = { ok: true, json: async () => { throw new SyntaxError('Unexpected token') } } as unknown as Response
    const err = await sliceStl(stl, { fetchImpl: fetchOf(async () => badBody) })
      .then(() => null, (e) => e as SlicerError)
    expect(err).toBeInstanceOf(SlicerError)
    expect(err?.kind).toBe('offline')
  })
})
