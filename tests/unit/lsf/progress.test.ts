import { describe, it, expect } from 'vitest'
import { lsfProgressLabel, LSF_PROGRESS_STAGES } from '@/lib/lsf/progress'

describe('lsfProgressLabel', () => {
  it('starts at the first stage', () => {
    expect(lsfProgressLabel(0)).toBe(LSF_PROGRESS_STAGES[0].label)
  })

  it('advances by elapsed seconds', () => {
    expect(lsfProgressLabel(3)).toContain('Tessellando')
    expect(lsfProgressLabel(14)).toContain('3MF')
    expect(lsfProgressLabel(40)).toMatch(/1–2 min|1-2 min|processando/i)
  })
})
