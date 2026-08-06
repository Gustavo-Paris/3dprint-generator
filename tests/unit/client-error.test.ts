import { describe, it, expect } from 'vitest'
import { extractApiError, userSafeErrorMessage } from '@/lib/http/client-error'

describe('extractApiError', () => {
  it('reads error.message from the apiError envelope', () => {
    const body = JSON.stringify({ error: { code: 'x', message: 'Peça não encontrada.' } })
    expect(extractApiError(body, 404)).toBe('Peça não encontrada.')
  })

  it('falls back to generic PT-BR on raw text', () => {
    expect(extractApiError('Internal Server Error', 500)).toMatch(/Algo deu errado/)
  })
})

describe('userSafeErrorMessage', () => {
  it('keeps short clean PT-BR messages', () => {
    expect(userSafeErrorMessage('Não foi possível gerar a peça.')).toBe(
      'Não foi possível gerar a peça.',
    )
  })

  it('strips Error: prefix', () => {
    expect(userSafeErrorMessage('Error: Falha no upload.')).toBe('Falha no upload.')
  })

  it('hides SQL / stack dumps', () => {
    const dirty =
      'Failed query: insert into "iterations" ("id") values ($1)\n    at NodePgPreparedQuery.queryWithCache'
    const out = userSafeErrorMessage(dirty)
    expect(out).not.toMatch(/insert into/i)
    expect(out).not.toMatch(/queryWithCache/)
    expect(out.length).toBeLessThan(80)
  })

  it('hides filesystem paths', () => {
    expect(userSafeErrorMessage('ENOENT: no such file /Users/me/secret.stl')).not.toMatch(
      /\/Users\//,
    )
  })
})
