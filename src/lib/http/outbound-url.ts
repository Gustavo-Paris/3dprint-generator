/**
 * Guard for admin-configured outbound URLs (AI base URL, slicer URL).
 *
 * Trust model: only the admin (see env.isAdminEmail) can set these — the same
 * trust level as setting an env var on the deploy. LOCAL and LAN endpoints are
 * INTENTIONALLY allowed: running your own model on localhost (Ollama/LM Studio)
 * or a LAN host is a first-class, documented use case, so we do NOT block
 * 127.0.0.0/8 or RFC1918 ranges (that would break it).
 *
 * What we DO block is the cloud instance-metadata endpoint — link-local
 * 169.254.0.0/16 and the known metadata hostnames — which is never a valid
 * model/slicer host and is the classic SSRF target. Hostnames that resolve to
 * those addresses via DNS are out of scope (admin-trusted); this is a cheap,
 * feature-preserving guard, not a full SSRF firewall.
 */
export function assertSafeOutboundUrl(raw: string, label = 'URL'): void {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`${label} inválida.`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${label} deve usar http ou https.`)
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') || // link-local (AWS/GCP/Azure metadata)
    host === 'fd00:ec2::254' || // AWS IMDS over IPv6
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    throw new Error(`${label}: endereço de metadados da nuvem não é permitido.`)
  }
}
