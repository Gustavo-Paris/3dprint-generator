/**
 * Symmetric encryption for secrets stored at rest (API keys in app_settings).
 *
 * The key is derived from AUTH_SECRET (always present) via scrypt, so there's no
 * extra required env var and the key is instance-specific. Rotating AUTH_SECRET
 * invalidates previously-stored secrets — re-enter them in Settings after a rotate.
 *
 * Format: "<ivB64>:<tagB64>:<cipherB64>" (AES-256-GCM, 96-bit IV, 128-bit tag).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { env } from '@/env'

// One-time derivation at module load. scrypt is intentionally slow; fine once.
const KEY = scryptSync(env.AUTH_SECRET, '3dgen-settings-enc-v1', 32)

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed secret payload')
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** Mask a secret for display — never sends the plaintext to the client. */
export function maskSecret(plaintext: string | null | undefined): string {
  if (!plaintext) return ''
  const tail = plaintext.slice(-4)
  return `••••••••${tail}`
}
