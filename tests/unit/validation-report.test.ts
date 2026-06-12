import { describe, it, expect } from 'vitest'
import { CachedDesign, readCachedDesign } from '@/lib/storage/validation-report'

describe('CachedDesign / readCachedDesign', () => {
  it('parses an imported design with cached faces + previews', () => {
    const raw = {
      kind: 'imported',
      baseMeshUrl: 'https://blob/x.3mf',
      edits: [],
      _faces: [{ id: 0, normal: [0, 0, 1], centroid: [0, 0, 0], areaMm2: 1,
        triangleIndices: [0], bboxOnPlane: { min: [0, 0], max: [1, 1] } }],
      _previews: { top: 'd', front: 'd', right: 'd', iso: 'd' },
    }
    const parsed = CachedDesign.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.kind === 'imported') {
      expect(parsed.data.baseMeshUrl).toBe('https://blob/x.3mf')
      expect(parsed.data._faces?.length).toBe(1)
    }
  })

  it('readCachedDesign returns null for a malformed row instead of throwing', () => {
    expect(readCachedDesign({ kind: 'nonsense', foo: 1 })).toBeNull()
    expect(readCachedDesign(null)).toBeNull()
  })

  it('readCachedDesign returns the typed design for a valid parametric row', () => {
    const d = readCachedDesign({ kind: 'flat_plate', widthMm: 50, heightMm: 40, thicknessMm: 3, cornerRadiusMm: 2 })
    expect(d?.kind).toBe('flat_plate')
  })
})
