import { describe, it, expect } from 'vitest'
import { resolveInsidePublic } from '@/lib/http/resolve-inside-public'

describe('resolveInsidePublic', () => {
  it('resolves a normal public-relative path', () => {
    const p = resolveInsidePublic('/uploads/abc.png')
    expect(p.endsWith('/public/uploads/abc.png')).toBe(true)
  })
  it('throws on traversal that escapes public/', () => {
    expect(() => resolveInsidePublic('/../../etc/passwd')).toThrow(/escapes/)
    expect(() => resolveInsidePublic('/uploads/../../../secret')).toThrow(/escapes/)
  })
})
