import { describe, it, expect } from 'vitest'
import { isUuid } from '@/lib/validation/uuid'

describe('isUuid', () => {
  it('accepts a canonical v4 uuid', () => {
    expect(isUuid('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true)
  })

  it('rejects a non-uuid route param', () => {
    expect(isUuid('not-a-uuid')).toBe(false)
  })

  it('rejects empty string and obvious junk', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid('123')).toBe(false)
    expect(isUuid('../../etc/passwd')).toBe(false)
  })

  it('rejects a uuid with surrounding whitespace', () => {
    expect(isUuid(' a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d ')).toBe(false)
  })
})
