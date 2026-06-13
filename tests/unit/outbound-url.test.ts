import { describe, it, expect } from 'vitest'
import { assertSafeOutboundUrl } from '@/lib/http/outbound-url'

describe('assertSafeOutboundUrl', () => {
  it('allows localhost / LAN / public https (self-hosted local models are first-class)', () => {
    expect(() => assertSafeOutboundUrl('http://localhost:11434/v1')).not.toThrow()
    expect(() => assertSafeOutboundUrl('http://127.0.0.1:1234/v1')).not.toThrow()
    expect(() => assertSafeOutboundUrl('http://192.168.1.50:11434/v1')).not.toThrow()
    expect(() => assertSafeOutboundUrl('http://10.0.0.5:8000/v1')).not.toThrow()
    expect(() => assertSafeOutboundUrl('https://openrouter.ai/api/v1')).not.toThrow()
  })

  it('blocks cloud instance-metadata endpoints', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')).toThrow()
    expect(() => assertSafeOutboundUrl('http://169.254.170.2/')).toThrow()
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal/computeMetadata/v1/')).toThrow()
    expect(() => assertSafeOutboundUrl('http://[fd00:ec2::254]/')).toThrow()
  })

  it('rejects non-http(s) schemes and malformed input', () => {
    expect(() => assertSafeOutboundUrl('file:///etc/passwd')).toThrow()
    expect(() => assertSafeOutboundUrl('gopher://x/')).toThrow()
    expect(() => assertSafeOutboundUrl('not a url')).toThrow()
  })
})
