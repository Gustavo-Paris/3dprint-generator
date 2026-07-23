/**
 * Preview-bundle helpers for the imported-mesh flow.
 *
 * The generate route strips `_previews` (4 base64 PNGs, up to ~806KB/row) from
 * its bulk history read for prompt-size reasons, then re-fetches ONLY the
 * newest real bundle in a targeted single-row query. These helpers centralize
 * the stub bundle (used when nothing real exists — paint/logo placement paths
 * ignore previews) and the validation of a bundle read back from jsonb.
 */
import type { PreviewBundle } from '@/lib/design/parse-import'

/** 1×1 transparent PNG — placeholder when no real capture is available. */
export const STUB_PREVIEW =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export const STUB_PREVIEW_BUNDLE: PreviewBundle = {
  top: STUB_PREVIEW,
  front: STUB_PREVIEW,
  right: STUB_PREVIEW,
  iso: STUB_PREVIEW,
}

const VIEWS = ['top', 'front', 'right', 'iso'] as const

/** True when every view is the 1×1 stub — never worth caching or showing an LLM. */
export function isStubPreviewBundle(b: PreviewBundle): boolean {
  return VIEWS.every((v) => b[v] === STUB_PREVIEW)
}

/**
 * Validate an unknown value (jsonb `_previews` read back from the DB) into a
 * PreviewBundle. Returns null unless all four views are image data URLs.
 */
export function readPreviewBundle(v: unknown): PreviewBundle | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  for (const view of VIEWS) {
    const s = o[view]
    if (typeof s !== 'string' || !s.startsWith('data:image/')) return null
  }
  return { top: o.top, front: o.front, right: o.right, iso: o.iso } as PreviewBundle
}
