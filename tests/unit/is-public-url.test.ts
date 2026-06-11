import { describe, it, expect } from 'vitest'
import { isPublicUrl } from '@/lib/http/is-public-url'

describe('isPublicUrl', () => {
  it('allows ordinary public https hosts', () => {
    expect(isPublicUrl('https://example.com/logo.png')).toBe(true)
  })
  it('rejects loopback', () => {
    expect(isPublicUrl('http://127.0.0.1/x')).toBe(false)
    expect(isPublicUrl('http://localhost/x')).toBe(false)
    expect(isPublicUrl('http://[::1]/x')).toBe(false)
  })
  it('rejects private + link-local + metadata ranges', () => {
    expect(isPublicUrl('http://10.0.0.5/x')).toBe(false)
    expect(isPublicUrl('http://192.168.1.1/x')).toBe(false)
    expect(isPublicUrl('http://172.16.0.1/x')).toBe(false)
    expect(isPublicUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
  })
  it('rejects non-http(s) schemes', () => {
    expect(isPublicUrl('file:///etc/passwd')).toBe(false)
    expect(isPublicUrl('ftp://example.com/x')).toBe(false)
    expect(isPublicUrl('not a url')).toBe(false)
  })
})
