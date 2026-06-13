import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto/secret'

describe('secret crypto (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const plain = 'sk-test-abc123'
    const enc = encryptSecret(plain)
    expect(enc).not.toContain(plain)
    expect(enc.split(':')).toHaveLength(3)
    expect(decryptSecret(enc)).toBe(plain)
  })

  it('uses a random IV (same input → different ciphertext)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'))
  })

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('hello world')
    const [iv, tag, data] = enc.split(':')
    const flipped = (data[0] === 'A' ? 'B' : 'A') + data.slice(1)
    expect(() => decryptSecret(`${iv}:${tag}:${flipped}`)).toThrow()
  })

  it('throws on malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow()
  })

  it('masks a secret without leaking the body', () => {
    const masked = maskSecret('sk-supersecret-tail')
    expect(masked.endsWith('tail')).toBe(true)
    expect(masked).not.toContain('supersecret')
    expect(maskSecret(null)).toBe('')
    expect(maskSecret('')).toBe('')
  })
})
