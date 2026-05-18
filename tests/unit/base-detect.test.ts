import { describe, it, expect } from 'vitest'
import { detectBaseMode } from '@/lib/prompt/base-detect'

describe('detectBaseMode', () => {
  it('treats "trofeu/trophy" alone as the whole object, not a separate base', () => {
    // These describe what the user wants printed, NOT a separate pedestal.
    expect(detectBaseMode('troféu da logo da empresa')).toBe('mesh_only')
    expect(detectBaseMode('TROFEU pra o concurso')).toBe('mesh_only')
    expect(detectBaseMode('a trophy for the championship')).toBe('mesh_only')
    expect(detectBaseMode('award for the team')).toBe('mesh_only')
  })

  it('detects explicit base/pedestal requests in pt-BR', () => {
    expect(detectBaseMode('quero o trofeu numa base hexagonal')).toBe('with_base')
    expect(detectBaseMode('logo sobre um pedestal de madeira')).toBe('with_base')
    expect(detectBaseMode('montado em cima de uma base baixa')).toBe('with_base')
    expect(detectBaseMode('com pedestal stepped')).toBe('with_base')
  })

  it('detects explicit base/pedestal requests in english', () => {
    expect(detectBaseMode('logo on a pedestal')).toBe('with_base')
    expect(detectBaseMode('PG monogram mounted on a base')).toBe('with_base')
    expect(detectBaseMode('with a plinth underneath')).toBe('with_base')
  })

  it('returns mesh_only when no base/pedestal phrase present', () => {
    expect(detectBaseMode('logo extrudada')).toBe('mesh_only')
    expect(detectBaseMode('my company logo')).toBe('mesh_only')
    expect(detectBaseMode('iron man helmet')).toBe('mesh_only')
  })

  it('negative phrases veto base even when a positive keyword appears', () => {
    expect(detectBaseMode('quero um pedestal, na verdade nao quero pedestal')).toBe('mesh_only')
    expect(detectBaseMode('sobre uma base, mas tira a base depois')).toBe('mesh_only')
    expect(detectBaseMode('logo on a pedestal but without base')).toBe('mesh_only')
  })

  it('captures common user phrasings for "no base"', () => {
    expect(detectBaseMode('nao quero a base arredondada')).toBe('mesh_only')
    expect(detectBaseMode('sem essa base embaixo')).toBe('mesh_only')
    expect(detectBaseMode('tira a base, deixa só o trofeu')).toBe('mesh_only')
    expect(detectBaseMode('apenas a logo, em formato de trofeu')).toBe('mesh_only')
    expect(detectBaseMode('drop the base, keep only the logo')).toBe('mesh_only')
  })

  it('is case-insensitive', () => {
    expect(detectBaseMode('Logo ON A PEDESTAL')).toBe('with_base')
    expect(detectBaseMode('SEM BASE por favor')).toBe('mesh_only')
  })
})
