import { lookup } from 'node:dns/promises'

/**
 * SSRF guard for user-supplied external URLs (e.g. /api/generate imageUrl).
 *
 * Two layers:
 *   - isPublicUrl(raw): sync structural gate — scheme + host-LITERAL ranges
 *     (IPv4 incl. decimal/octal forms WHATWG normalises, and IPv6 incl. the
 *     IPv4-mapped hex form `::ffff:7f00:1` the URL parser emits). A bare DNS
 *     name passes here (its literal is public-looking).
 *   - assertUrlIsPublic(raw): full gate — resolves the host and rejects if ANY
 *     resolved address is private/loopback/link-local/metadata. Fail-closed on
 *     resolution failure. Use this at the fetch site.
 *
 * Residual: a TOCTOU/DNS-rebinding window remains between resolve and fetch;
 * fetch is called with redirect:'manual' to stop redirect-to-internal, and the
 * blast radius is a logo-image GET whose bytes are never reflected to the client.
 */

function isBlockedIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  if (o.some((n) => n > 255)) return true             // malformed octet → block
  const [a, b] = o
  if (a === 0 || a === 10 || a === 127) return true   // this-network / private / loopback
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true             // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true    // 172.16/12
  if (a === 100 && b >= 64 && b <= 127) return true   // 100.64/10 CGNAT
  if (a >= 224) return true                           // multicast + reserved
  return false
}

/** Decode the embedded IPv4 of an IPv4-mapped IPv6, dotted or hex form. */
function mappedIPv4(v6: string): string | null {
  const dotted = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) return dotted[1]
  const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.')
  }
  return null
}

function isBlockedIPv6(raw: string): boolean {
  const v6 = raw.replace(/^\[|\]$/g, '').toLowerCase()
  if (v6 === '::1' || v6 === '::') return true              // loopback + unspecified
  const mapped = mappedIPv4(v6)
  if (mapped) return isBlockedIPv4(mapped)                  // IPv4-mapped → judge embedded v4
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true  // ULA fc00::/7
  if (/^fe[89ab]/.test(v6)) return true                    // link-local fe80::/10
  if (/^fe[c-f]/.test(v6)) return true                     // site-local fec0::/10 (deprecated)
  return false
}

/** Classify a resolved IP string (IPv4 or IPv6, bracketed or bare). */
function isBlockedIp(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, '').toLowerCase()
  return host.includes(':') ? isBlockedIPv6(host) : isBlockedIPv4(host)
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

export function isPublicUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.includes(':')) return !isBlockedIPv6(host)
  if (IPV4_RE.test(host)) return !isBlockedIPv4(host)
  // Bare DNS name — structurally allowed; assertUrlIsPublic resolves it.
  return true
}

/**
 * Full SSRF gate: structural check + DNS resolution. Every resolved address
 * must be public. Fail-closed (rejects) when the host cannot be resolved.
 */
export async function assertUrlIsPublic(raw: string): Promise<boolean> {
  if (!isPublicUrl(raw)) return false
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  // Host is already an IP literal — isPublicUrl settled it; no DNS needed.
  if (host.includes(':') || IPV4_RE.test(host)) return true
  try {
    const addrs = await lookup(host, { all: true })
    if (addrs.length === 0) return false
    return addrs.every((a) => !isBlockedIp(a.address))
  } catch {
    return false
  }
}
