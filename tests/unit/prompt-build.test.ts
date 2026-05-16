import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from '@/lib/prompt/system'

describe('SYSTEM_PROMPT (Phase 1: single-body)', () => {
  it('declares mm as the unit', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('mm')
  })
  it('mandates a main() function with single-body return', () => {
    expect(SYSTEM_PROMPT).toMatch(/main\s*\(\s*\)/)
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('return')
  })
  it('references @jscad/modeling', () => {
    expect(SYSTEM_PROMPT).toContain('@jscad/modeling')
  })
  it('forbids non-JSCAD imports', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/(no|only).*(import|require)/)
  })
})
