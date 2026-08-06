import { describe, it, expect } from 'vitest'
import { STARTER_PRESETS, findPreset, kindLabelForStrategy } from '@/lib/projects/presets'

describe('STARTER_PRESETS', () => {
  it('has unique ids and non-empty prompts', () => {
    const ids = STARTER_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of STARTER_PRESETS) {
      expect(p.prompt.trim().length).toBeGreaterThan(8)
      expect(p.title.trim().length).toBeGreaterThan(2)
    }
  })

  it('findPreset resolves by id', () => {
    expect(findPreset('keychain')?.emoji).toBe('🔑')
    expect(findPreset('nope')).toBeUndefined()
  })
})

describe('kindLabelForStrategy', () => {
  it('maps known strategies to short PT-BR', () => {
    expect(kindLabelForStrategy('lsf_maquette')).toBe('LSF')
    expect(kindLabelForStrategy('freeform')).toBe('Freeform')
    expect(kindLabelForStrategy('flexified')).toBe('Flexi')
  })

  it('hides legacy generative/parametric noise', () => {
    expect(kindLabelForStrategy('generative')).toBeNull()
    expect(kindLabelForStrategy(null)).toBeNull()
  })
})
