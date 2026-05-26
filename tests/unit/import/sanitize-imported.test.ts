import { describe, it, expect } from 'vitest'
import { sanitizeDesign } from '@/lib/design/sanitize'
import type { Design } from '@/lib/design/schema'

describe('sanitizeDesign(imported)', () => {
  it('passes imported designs through unchanged', () => {
    const d: Design = {
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [{ op: 'scale', factor: 2 }],
    }
    const { design, adjustments } = sanitizeDesign(d)
    expect(adjustments).toEqual([])
    expect(design).toEqual(d)
  })
})
