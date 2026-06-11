import { describe, it, expect } from 'vitest'
import { apiError } from '@/lib/http/api-error'

describe('apiError', () => {
  it('returns a JSON Response with status, code and message', async () => {
    const res = apiError(401, 'unauthenticated', 'Faça login para continuar.')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const body = await res.json()
    expect(body).toEqual({ error: { code: 'unauthenticated', message: 'Faça login para continuar.' } })
  })

  it('optionally carries an iteration_id for the client to poll', async () => {
    const res = apiError(500, 'build_failed', 'Não foi possível gerar a peça.', { iteration_id: 'abc' })
    expect(await res.json()).toEqual({
      error: { code: 'build_failed', message: 'Não foi possível gerar a peça.' },
      iteration_id: 'abc',
    })
  })
})
