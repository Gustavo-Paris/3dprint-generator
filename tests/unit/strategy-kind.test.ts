import { describe, it, expect } from 'vitest'
import { iterationStrategies, designKindToStrategy } from '@/db/strategy'

describe('strategy column reflects real design kind', () => {
  it('enumerates every Design kind plus flexified', () => {
    for (const k of [
      'hollow_cylinder', 'flat_plate', 'disc', 'bookmark', 'pin',
      'custom_keychain', 'mug', 'imported', 'composite', 'freeform', 'flexified',
      'parametric_code', 'box', 'lsf_maquette',
    ]) {
      expect(iterationStrategies).toContain(k)
    }
  })
  it('maps an imported design to "imported", not "generative"', () => {
    expect(designKindToStrategy('imported')).toBe('imported')
  })
  it('maps lsf_maquette design kind to strategy lsf_maquette', () => {
    expect(designKindToStrategy('lsf_maquette')).toBe('lsf_maquette')
  })
  it('falls back to "generative" for an unknown kind', () => {
    expect(designKindToStrategy('nonexistent_kind')).toBe('generative')
  })
})
