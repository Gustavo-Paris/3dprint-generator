import { describe, it, expect } from 'vitest'
import { deriveProjectTitle } from '@/lib/projects/derive-title'

describe('deriveProjectTitle', () => {
  it('falls back to a PT-BR default for empty input', () => {
    expect(deriveProjectTitle('')).toBe('Projeto sem título')
    expect(deriveProjectTitle('   ')).toBe('Projeto sem título')
  })

  it('takes the first line, trimmed and collapsed', () => {
    expect(deriveProjectTitle('  porta-lata cilíndrico\nsegunda linha ')).toBe('porta-lata cilíndrico')
  })

  it('truncates long prompts to 60 chars with an ellipsis', () => {
    const long = 'a'.repeat(80)
    const out = deriveProjectTitle(long)
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
  })

  it('strips an "(image only)" placeholder prompt', () => {
    expect(deriveProjectTitle('(image only)')).toBe('Projeto sem título')
  })
})
