import { describe, it, expect } from 'vitest'
import { extractApiError } from '@/lib/http/client-error'

const envelope = (message: string) => JSON.stringify({ error: { code: 'x', message } })

describe('extractApiError (string form)', () => {
  it('returns the PT-BR message from an apiError envelope', () => {
    expect(extractApiError(envelope('Projeto não encontrado.'))).toBe('Projeto não encontrado.')
  })

  it('falls back to a generic message for non-JSON bodies (never the raw text)', () => {
    const out = extractApiError('<html>Internal Server Error</html>', 500)
    expect(out).toBe('Algo deu errado (HTTP 500). Tente novamente.')
    expect(out).not.toContain('html')
  })

  it('falls back for JSON without the envelope shape', () => {
    expect(extractApiError(JSON.stringify({ message: 'nope' }), 502)).toBe(
      'Algo deu errado (HTTP 502). Tente novamente.',
    )
  })

  it('falls back for an envelope with an empty message', () => {
    expect(extractApiError(envelope('   '), 400)).toBe('Algo deu errado (HTTP 400). Tente novamente.')
  })

  it('omits the HTTP status when none is known', () => {
    expect(extractApiError('plain text')).toBe('Algo deu errado. Tente novamente.')
  })
})

describe('extractApiError (Response form)', () => {
  it('reads the envelope message from the response body', async () => {
    const res = new Response(envelope('Faça login para continuar.'), { status: 401 })
    await expect(extractApiError(res)).resolves.toBe('Faça login para continuar.')
  })

  it('uses the response status in the generic fallback', async () => {
    const res = new Response('not json at all', { status: 503 })
    await expect(extractApiError(res)).resolves.toBe('Algo deu errado (HTTP 503). Tente novamente.')
  })

  it('never rejects even if reading the body throws', async () => {
    const res = {
      status: 500,
      text: () => Promise.reject(new Error('stream aborted')),
    } as unknown as Response
    await expect(extractApiError(res)).resolves.toBe('Algo deu errado (HTTP 500). Tente novamente.')
  })
})
