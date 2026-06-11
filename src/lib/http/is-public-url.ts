/**
 * SSRF guard for user-supplied external URLs (e.g. /api/generate imageUrl).
 *
 * Only http(s) on a host that is NOT loopback / private / link-local / CGNAT /
 * the cloud metadata IP. Hostname-literal IPs are checked directly; DNS-name
 * hosts pass the literal check (a resolving attacker would need a public IP,
 * and fetch is called with redirect:'manual' to stop redirect-to-internal).
 */
function isBlockedIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true            // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true    // 172.16/12
  if (a === 100 && b >= 64 && b <= 127) return true   // 100.64/10 CGNAT
  return false
}

export function isPublicUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host === '::1' || host === '[::1]') return false
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false // ULA + IPv6 link-local
  if (isBlockedIPv4(host)) return false
  return true
}
