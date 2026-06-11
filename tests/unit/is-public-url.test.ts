import { describe, it, expect } from 'vitest'
import { isPublicUrl, assertUrlIsPublic } from '@/lib/http/is-public-url'

describe('isPublicUrl', () => {
  it('allows ordinary public https hosts', () => {
    expect(isPublicUrl('https://example.com/logo.png')).toBe(true)
  })
  it('allows a genuinely public IPv6 literal', () => {
    expect(isPublicUrl('http://[2607:f8b0::1]/x')).toBe(true)
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
  it('rejects decimal / octal / short IPv4 forms that WHATWG normalises', () => {
    expect(isPublicUrl('http://2130706433/x')).toBe(false)   // 127.0.0.1
    expect(isPublicUrl('http://0x7f.0.0.1/x')).toBe(false)   // 127.0.0.1
    expect(isPublicUrl('http://127.1/x')).toBe(false)        // 127.0.0.1
  })
  it('rejects IPv6 unspecified, IPv4-mapped, ULA and site-local', () => {
    expect(isPublicUrl('http://[::]/x')).toBe(false)
    expect(isPublicUrl('http://[::ffff:127.0.0.1]/x')).toBe(false)        // -> ::ffff:7f00:1
    expect(isPublicUrl('http://[::ffff:169.254.169.254]/x')).toBe(false) // metadata via mapped
    expect(isPublicUrl('http://[fc00::1]/x')).toBe(false)
    expect(isPublicUrl('http://[fd12:3456::1]/x')).toBe(false)
    expect(isPublicUrl('http://[fe80::1]/x')).toBe(false)
    expect(isPublicUrl('http://[fec0::1]/x')).toBe(false)
  })
  it('rejects non-http(s) schemes', () => {
    expect(isPublicUrl('file:///etc/passwd')).toBe(false)
    expect(isPublicUrl('ftp://example.com/x')).toBe(false)
    expect(isPublicUrl('not a url')).toBe(false)
  })
})

describe('assertUrlIsPublic', () => {
  it('rejects blocked IP literals without touching DNS', async () => {
    expect(await assertUrlIsPublic('http://127.0.0.1/x')).toBe(false)
    expect(await assertUrlIsPublic('http://169.254.169.254/x')).toBe(false)
    expect(await assertUrlIsPublic('http://[::ffff:127.0.0.1]/x')).toBe(false)
    expect(await assertUrlIsPublic('file:///etc/passwd')).toBe(false)
  })
  it('accepts a public IP literal without touching DNS', async () => {
    expect(await assertUrlIsPublic('http://[2607:f8b0::1]/x')).toBe(true)
    expect(await assertUrlIsPublic('http://93.184.216.34/x')).toBe(true)
  })
})
