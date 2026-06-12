import { describe, it, expect } from 'vitest'
import { isOwnMeshUrl } from '@/lib/http/owns-mesh-url'

const USER = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const BLOB = 'https://store1.public.blob.vercel-storage.com'

describe('isOwnMeshUrl', () => {
  it('accepts a prior iteration mesh in this project (ownMeshUrls)', () => {
    const set = new Set([`${BLOB}/${USER}/proj/iter.3mf`])
    expect(isOwnMeshUrl(`${BLOB}/${USER}/proj/iter.3mf`, USER, set)).toBe(true)
  })

  it('accepts a fresh upload under the caller blob namespace', () => {
    expect(isOwnMeshUrl(`${BLOB}/${USER}/uploads/abc.3mf`, USER, new Set())).toBe(true)
  })

  it('accepts local-dev /uploads and /meshes artifacts', () => {
    expect(isOwnMeshUrl('/uploads/abc.3mf', USER, new Set())).toBe(true)
    expect(isOwnMeshUrl('/meshes/abc.3mf', USER, new Set())).toBe(true)
  })

  it("rejects another user's blob path (IDOR)", () => {
    expect(isOwnMeshUrl(`${BLOB}/${OTHER}/uploads/abc.3mf`, USER, new Set())).toBe(false)
  })

  it('rejects an arbitrary http host (SSRF)', () => {
    expect(isOwnMeshUrl('http://169.254.169.254/latest/meta-data', USER, new Set())).toBe(false)
    expect(isOwnMeshUrl(`https://evil.com/${USER}/x.3mf`, USER, new Set())).toBe(false)
    expect(isOwnMeshUrl(`http://store1.public.blob.vercel-storage.com/${USER}/x.3mf`, USER, new Set())).toBe(false) // http, not https
  })

  it('rejects a look-alike blob host', () => {
    expect(isOwnMeshUrl(`https://public.blob.vercel-storage.com.evil.com/${USER}/x.3mf`, USER, new Set())).toBe(false)
  })

  it('rejects local traversal', () => {
    expect(isOwnMeshUrl('/uploads/../../etc/passwd', USER, new Set())).toBe(false)
    expect(isOwnMeshUrl('/etc/passwd', USER, new Set())).toBe(false)
  })
})
