import { describe, it, expect, vi } from 'vitest'
import { requestFlexify } from '@/components/flexify-request'

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('requestFlexify', () => {
  it('POSTs only projectId to /api/flexify and maps the snake_case response', async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ iteration_id: 'it-1', mesh_url: 'https://blob/x.3mf', mesh_base64: null }),
    )
    const r = await requestFlexify('proj-123', fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/flexify')
    expect(init?.method).toBe('POST')
    // Front must NOT invent a meshUrl — the route resolves the latest ready mesh
    // and the allowlist only accepts server-issued URLs.
    expect(JSON.parse(init?.body as string)).toEqual({ projectId: 'proj-123' })
    expect(r).toEqual({ iterationId: 'it-1', meshUrl: 'https://blob/x.3mf', meshBase64: null })
  })

  it('throws with the JSON {error} message on a 500 (route returns JSON on flexify failure)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'Flexify failed to process the mesh.', iteration_id: 'it-2' }, 500),
    )
    await expect(
      requestFlexify('p', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('Flexify failed to process the mesh.')
  })

  it('throws with the plain-text body on a 4xx (route returns text for validation/auth errors)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('No source mesh: generate or upload a mesh first', { status: 400 }),
    )
    await expect(
      requestFlexify('p', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('No source mesh')
  })

  it('falls back to a status-coded message when the error body is empty', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }))
    await expect(
      requestFlexify('p', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('403')
  })
})
