/**
 * Pattern-match common iteration phrases ("logo maior", "mais alto",
 * "vazada", "tira a alça", "buraco do lado") and apply the modification
 * deterministically against the previous Design — bypassing the LLM
 * entirely.
 *
 * Why this exists: even with a strong system prompt, Haiku occasionally
 * returns the previous design verbatim instead of applying a numeric bump.
 * For pure modifiers there's no language understanding needed, so we
 * short-circuit. Anything we don't match falls through to the LLM.
 *
 * Returns the modified Design when a pattern matches, or null otherwise.
 */
import type { Design, LogoSpec } from './schema'

type HangingHolePosition = NonNullable<
  Extract<Design, { kind: 'flat_plate' }>['hangingHole']
>['position']

const SIZE_BUMP = 0.15
const DIM_BUMP = 1.2 // multiplicative

export function tryQuickModify(message: string, prev: Design | null): Design | null {
  if (!prev) return null
  // Composites have ambiguous targets ("logo maior" — which part's logo?).
  // Fall through to the LLM, which sees the full structure and decides.
  if (prev.kind === 'composite') return null
  // parametric_code changes go through spec + code regeneration — a numeric
  // bump on the design object can't reach inside the generated code.
  if (prev.kind === 'parametric_code') return null
  const m = message.toLowerCase().trim()

  // ── Logo size ────────────────────────────────────────────────────────
  // Generous matching: catches "logo maior", "aumenta a logo", "aumenta mais",
  // "ainda maior", "mais grande", "muito maior", "bem maior", etc.
  if (/\b(logo|imagem|estampa)\s*(maior|grande|aumenta|cresce)/.test(m) ||
      /\b(aumenta|cresce)\s+(o |a )?\s*logo/.test(m) ||
      /\b(aumenta|cresce|maior|grande)\s+(mais|ainda|um pouco|bem|muito)/.test(m) ||
      /\b(ainda|mais|bem|muito|um pouco)\s+(maior|grande)/.test(m) ||
      /^aumenta\s*(mais)?$/.test(m) ||
      /^maior$/.test(m)) {
    return bumpLogoSize(prev, +SIZE_BUMP)
  }
  if (/\b(logo|imagem|estampa)\s*(menor|pequen|diminui|reduz)/.test(m) ||
      /\b(diminui|reduz)\s+(o |a )?\s*logo/.test(m) ||
      /\b(diminui|reduz|menor|pequen)\s+(mais|ainda|um pouco|bem|muito)/.test(m) ||
      /\b(ainda|mais|bem|muito|um pouco)\s+(menor|pequen)/.test(m) ||
      /^diminui\s*(mais)?$/.test(m) ||
      /^menor$/.test(m)) {
    return bumpLogoSize(prev, -SIZE_BUMP)
  }

  // ── Logo treatment ───────────────────────────────────────────────────
  if (/\b(vazad[oa]|passante|cut\s*through|through.?cut)\b/.test(m) && hasLogo(prev)) {
    return setLogoTreatment(prev, 'through_cut')
  }
  if (/\b(gravad[oa]|engraved|carved|debossed)\b/.test(m) && hasLogo(prev)) {
    return setLogoTreatment(prev, 'engraved')
  }
  if (/\b(em\s*relevo|saliente|raised|embossed)\b/.test(m) && hasLogo(prev)) {
    return setLogoTreatment(prev, 'embossed')
  }

  // ── Dimensions (height / width) ──────────────────────────────────────
  if (/\bmais\s*alt[oa]\b/.test(m) || /\btaller\b/.test(m)) {
    return scaleDim(prev, 'height', DIM_BUMP)
  }
  if (/\bmais\s*baix[oa]\b/.test(m) || /\bshorter\b/.test(m)) {
    return scaleDim(prev, 'height', 1 / DIM_BUMP)
  }
  if (/\bmais\s*largo\b/.test(m) || /\bwider\b/.test(m)) {
    return scaleDim(prev, 'width', DIM_BUMP)
  }
  if (/\bmais\s*estreit[oa]\b/.test(m) || /\bnarrower\b/.test(m)) {
    return scaleDim(prev, 'width', 1 / DIM_BUMP)
  }

  // ── Handle add / remove (hollow_cylinder only) ───────────────────────
  if (prev.kind === 'hollow_cylinder') {
    if (/\b(tira|remove|sem)\s+(a\s+)?al[çc]a\b/.test(m)) {
      return { ...prev, handle: undefined }
    }
    if (/\b(com|p[õo]e|adiciona|add)\s+(uma\s+)?al[çc]a\b/.test(m) && !prev.handle) {
      return {
        ...prev,
        handle: {
          heightMm: 60, stickOutMm: 28, thicknessMm: 8, fingerHoleDiameterMm: 22,
        },
      }
    }
  }

  // ── Hanging hole position (flat_plate / disc / bookmark) ─────────────
  if (prev.kind === 'flat_plate' || prev.kind === 'disc' || prev.kind === 'bookmark') {
    const newPos = parseHolePosition(m)
    if (newPos && prev.hangingHole) {
      return { ...prev, hangingHole: { ...prev.hangingHole, position: newPos } }
    }
  }

  return null
}

function parseHolePosition(m: string): HangingHolePosition | null {
  // Check most specific patterns first (corners before sides).
  if (/\b(canto|corner)\s+(superior|cima|top)\s+(esquerd|left)/.test(m) ||
      /\b(top.?left|cima.?esquerd)\b/.test(m)) return 'top_left'
  if (/\b(canto|corner)\s+(superior|cima|top)\s+(direit|right)/.test(m) ||
      /\b(top.?right|cima.?direit)\b/.test(m)) return 'top_right'
  if (/\b(buraco|furo|hole).{0,20}\b(esquerd|left)\b/.test(m) ||
      /\b(esquerd|left).{0,20}\b(buraco|furo|hole)\b/.test(m) ||
      /\bdo\s+lado\s+esquerd/.test(m)) return 'left'
  if (/\b(buraco|furo|hole).{0,20}\b(direit|right)\b/.test(m) ||
      /\b(direit|right).{0,20}\b(buraco|furo|hole)\b/.test(m) ||
      /\bdo\s+lado\s+direit/.test(m)) return 'right'
  if (/\b(buraco|furo|hole).{0,20}\b(lado|side)\b/.test(m) ||
      /\bdo\s+lado\b/.test(m)) return 'right' // ambiguous "side" → default right
  if (/\b(buraco|furo|hole).{0,20}\b(baixo|bottom|inferior)\b/.test(m)) return 'bottom'
  if (/\b(buraco|furo|hole).{0,20}\b(cima|top|superior)\b/.test(m)) return 'top'
  return null
}

function hasLogo(d: Design): boolean {
  return 'logo' in d && d.logo !== undefined
}

function bumpLogoSize(d: Design, delta: number): Design | null {
  if (!hasLogo(d) || !('logo' in d) || !d.logo) return null
  const newRatio = Math.max(0.2, Math.min(0.95, d.logo.sizeRatio + delta))
  if (newRatio === d.logo.sizeRatio) return null
  return { ...d, logo: { ...d.logo, sizeRatio: newRatio } } as Design
}

function setLogoTreatment(d: Design, t: LogoSpec['treatment']): Design | null {
  if (!hasLogo(d) || !('logo' in d) || !d.logo) return null
  if (d.logo.treatment === t) return null
  return { ...d, logo: { ...d.logo, treatment: t } } as Design
}

function scaleDim(d: Design, axis: 'height' | 'width', factor: number): Design | null {
  if (d.kind === 'hollow_cylinder' && axis === 'height') {
    return { ...d, heightMm: clampDim(d.heightMm * factor) }
  }
  if (d.kind === 'flat_plate' || d.kind === 'bookmark') {
    if (axis === 'height') return { ...d, heightMm: clampDim(d.heightMm * factor) }
    if (axis === 'width')  return { ...d, widthMm:  clampDim(d.widthMm  * factor) }
  }
  if (d.kind === 'box') {
    if (axis === 'height') return { ...d, heightMm: clampDim(d.heightMm * factor) }
    if (axis === 'width')  return { ...d, widthMm:  clampDim(d.widthMm  * factor) }
  }
  // disc and pin have only diameter — interpret height/width bumps as diameter
  if (d.kind === 'disc' || d.kind === 'pin') {
    return { ...d, diameterMm: clampDim(d.diameterMm * factor) }
  }
  return null
}

function clampDim(v: number): number {
  return Math.max(20, Math.min(300, Math.round(v)))
}
