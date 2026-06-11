/** Drop `_`-prefixed cache keys (e.g. `_faces`, `_previews` — base64 PNG data
 *  URLs cached on imported designs) before a validationReport is fed back to the
 *  LLM as `previousDesign`, so megabytes of preview data never enter the prompt.
 *  Pure (no route/auth imports) so it's unit-testable in the node env. */
export function stripCacheKeys(vr: unknown): unknown {
  if (!vr || typeof vr !== 'object') return vr
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(vr as Record<string, unknown>)) {
    if (!k.startsWith('_')) out[k] = v
  }
  return out
}
