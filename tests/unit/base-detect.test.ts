import { describe, it, expect } from 'vitest'
import { detectBaseMode } from '@/lib/prompt/base-detect'

describe('detectBaseMode', () => {
  it('detects "troféu" in pt-BR', () => {
    expect(detectBaseMode('troféu da logo da empresa')).toBe('with_base')
    expect(detectBaseMode('TROFEU pra o concurso')).toBe('with_base')
  })

  it('detects "trophy" / "prize" in english', () => {
    expect(detectBaseMode('a trophy for the championship')).toBe('with_base')
    expect(detectBaseMode('prize stand for the company')).toBe('with_base')
    expect(detectBaseMode('award pedestal')).toBe('with_base')
  })

  it('returns mesh_only when no base keyword present', () => {
    expect(detectBaseMode('logo extrudada')).toBe('mesh_only')
    expect(detectBaseMode('my company logo')).toBe('mesh_only')
    expect(detectBaseMode('iron man helmet')).toBe('mesh_only')
  })

  it('negative phrases override keywords', () => {
    expect(detectBaseMode('troféu sem base')).toBe('mesh_only')
    expect(detectBaseMode('trophy no base')).toBe('mesh_only')
    expect(detectBaseMode('apenas a logo, não troféu')).toBe('mesh_only')
  })

  it('is case-insensitive', () => {
    expect(detectBaseMode('TROFEU')).toBe('with_base')
    expect(detectBaseMode('Trophy')).toBe('with_base')
  })
})
