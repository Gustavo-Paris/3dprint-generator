import { describe, it, expect } from 'vitest'
import { stripCacheKeys } from '@/lib/design/strip-cache-keys'

describe('stripCacheKeys', () => {
  it('removes _-prefixed keys (faces, previews) but keeps the design', () => {
    const vr = {
      kind: 'imported', baseMeshUrl: '/x.3mf', edits: [],
      _faces: [{ id: 0 }], _previews: { iso: 'data:image/png;base64,AAAA' },
    }
    const out = stripCacheKeys(vr) as Record<string, unknown>
    expect(out).toEqual({ kind: 'imported', baseMeshUrl: '/x.3mf', edits: [] })
    expect('_faces' in out).toBe(false)
    expect('_previews' in out).toBe(false)
  })
  it('passes through null and non-objects unchanged', () => {
    expect(stripCacheKeys(null)).toBeNull()
    expect(stripCacheKeys('x')).toBe('x')
  })
})
