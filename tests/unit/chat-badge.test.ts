import { describe, it, expect } from 'vitest'
import { badgeFor } from '@/components/Chat'

describe('badgeFor', () => {
  it('shows MESHY only for freeform designs', () => {
    expect(badgeFor({ kind: 'freeform', prompt: 'a dragon' })).toBe('meshy')
  })
  it('shows JSCAD for parametric primitives even though strategy is generative', () => {
    expect(badgeFor({ kind: 'flat_plate', widthMm: 80, heightMm: 40 })).toBe('jscad')
    expect(badgeFor({ kind: 'imported', baseMeshUrl: '/x.3mf' })).toBe('jscad')
  })
  it('falls back to jscad when design is missing/unknown', () => {
    expect(badgeFor(undefined)).toBe('jscad')
  })
})
