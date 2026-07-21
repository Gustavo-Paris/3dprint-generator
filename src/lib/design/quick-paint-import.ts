/**
 * Deterministic multi-colour edits for the imported-mesh chat path.
 *
 * Priority:
 *  1. Reference image attached → paint_from_image (matches character colours)
 *  2. Reset to mono → paint_region all A
 *  3. Geometric region words without image → paint_region presets
 *  4. Vague multi-colour without image → upper_half (last resort)
 */
import type { Design, Op } from './schema'

const MULTI_COLOR_RE =
  /\b(multi[\s-]?cor(?:es)?|multi[\s-]?colou?r|mais\s+(de\s+|que\s+)?uma\s+cor|duas\s+cores|2\s+cores|segunda\s+cor|dois\s+materiais|2\s+materiais|duas\s+extrusoras|pintar|colorir|pintura|filament[eo]s?\s+diferentes|partes?\s+espec[ií]ficas?|como\s+(n[ae]ssa|esta|essa)\s+imagem|igual\s+(ao|a)\s+(render|imagem|foto))\b/i

const RESET_RE =
  /\b(uma\s+s[oó]\s+cor|cor\s+[uú]nica|monocrom|remove\s+(a\s+)?(multi|segunda)\s*cor|sem\s+multi|voltar\s+tudo\s+(pra|para)\s+(a\s+)?(base|uma\s+cor)|tudo\s+(na\s+)?mesma\s+cor)\b/i

/** Wants image-driven paint even without classic multi-cor words. */
const IMAGE_PAINT_RE =
  /\b(partes?\s+espec[ií]ficas?|como\s+(n[ae]ssa|esta|essa)\s+(imagem|foto|render)|cores?\s+da\s+imagem|transferir\s+cores?|pintar\s+com\s+a\s+imagem)\b/i

type Region = NonNullable<Extract<Op, { op: 'paint_region' }>['region']>

function detectRegion(message: string): Region {
  const m = message.toLowerCase()
  if (/\b(topo|cima|cabe[cç]a|capacete|helmet|head|upper|superior)\b/.test(m)) {
    return 'upper_half'
  }
  if (
    /\b(base|embaixo|inferior|lower|p[eé]|corpo|tronco|bust|chest)\b/.test(m) &&
    !/\b(topo|cima|cabe[cç]a|capacete)\b/.test(m)
  ) {
    return 'lower_half'
  }
  if (/\b(frente|frontal|front|face|rosto|visor)\b/.test(m)) return 'front_faces'
  if (/\b(tr[aá]s|atr[aá]s|costas|back)\b/.test(m)) return 'back_faces'
  if (/\b(esquerda|left)\b/.test(m)) return 'left_faces'
  if (/\b(direita|right)\b/.test(m)) return 'right_faces'
  return 'upper_half'
}

/** True when the message is about multi-colour / paint (any strategy). */
export function isMultiColorRequest(message: string): boolean {
  return MULTI_COLOR_RE.test(message) || RESET_RE.test(message) || IMAGE_PAINT_RE.test(message)
}

export type ImportedDesign = Extract<Design, { kind: 'imported' }>

export function tryQuickPaintImport(
  message: string,
  baseMeshUrl: string,
  previousDesign: Design | null,
  opts: { hasReferenceImage?: boolean } = {},
): ImportedDesign | null {
  const hasImage = !!opts.hasReferenceImage
  const isReset = RESET_RE.test(message)
  const isMulti = MULTI_COLOR_RE.test(message) || IMAGE_PAINT_RE.test(message)
  if (!isReset && !isMulti) return null

  const priorEdits =
    previousDesign && previousDesign.kind === 'imported'
      ? previousDesign.edits.filter(
          (e) =>
            e.op !== 'paint_region' &&
            e.op !== 'paint_from_image' &&
            e.op !== 'paint_brush',
        )
      : []

  const base =
    previousDesign && previousDesign.kind === 'imported'
      ? previousDesign.baseMeshUrl
      : baseMeshUrl

  if (isReset) {
    return {
      kind: 'imported',
      baseMeshUrl: base,
      edits: [...priorEdits, { op: 'paint_region', extruder: 'A', region: 'all' }],
    }
  }

  // Best path: project the attached reference image onto the mesh.
  if (hasImage) {
    return {
      kind: 'imported',
      baseMeshUrl: base,
      edits: [...priorEdits, { op: 'paint_from_image', view: 'front' }],
    }
  }

  // "Partes específicas" without image: don't invent a bad half-split — leave to LLM/UI.
  if (IMAGE_PAINT_RE.test(message) && !MULTI_COLOR_RE.test(message)) {
    return null
  }

  // Geometric fallback when no reference image.
  return {
    kind: 'imported',
    baseMeshUrl: base,
    edits: [
      ...priorEdits,
      { op: 'paint_region', extruder: 'B', region: detectRegion(message) },
    ],
  }
}
