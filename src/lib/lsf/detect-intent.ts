/**
 * Detect natural-language intent for LSF maquete generation (no IFC yet).
 * Pure — used by Chat (client) and /api/generate (server safety net).
 */

export type LsfIntent = {
  matched: boolean
  /** Architectural scale 1:N when the user wrote e.g. "1:50" or "escala 100". */
  scale?: number
  /** true/false when the user mentioned fit-to-bed; undefined = keep default. */
  fitBed?: boolean
}

const INTENT_RES: RegExp[] = [
  /\blsf\b/,
  /light\s*steel\s*frame/,
  /steel\s*frame/,
  /steelprime/,
  /casa\s*real\s*park/,
  /maquete.+(lsf|steel|metal|estrutura|esqueleto)/,
  /(esqueleto|estrutura).+(metalic|metalic[oa]|steel|lsf|galvaniz)/,
  /\bifc\b.+(maquete|lsf|steel)/,
  /(maquete|modelo).+\bifc\b/,
  /steel\s*frame.+(maquete|imprim|print)/,
]

function normalize(message: string): string {
  return message
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * True when the user is asking for an LSF / steel-frame maquete rather than a
 * generic parametric piece. Does not require an IFC attachment.
 */
export function detectLsfIntent(message: string): LsfIntent {
  const t = normalize(message)
  if (!t) return { matched: false }

  const matched = INTENT_RES.some((re) => re.test(t))
  if (!matched) return { matched: false }

  let scale: number | undefined
  const scaleColon = t.match(/1\s*:\s*(\d{2,3})\b/)
  const scaleWord = t.match(/\bescala\s*(?:de\s*)?(\d{2,3})\b/)
  const raw = scaleColon?.[1] ?? scaleWord?.[1]
  if (raw) {
    const n = Number(raw)
    if (n >= 20 && n <= 500) scale = n
  }

  let fitBed: boolean | undefined
  if (/\b(sem\s+fit|nao\s+ajustar|n[aã]o\s+ajustar|no[\s-]?fit[\s-]?bed)\b/.test(t)) {
    fitBed = false
  } else if (/\b(fit[\s-]?bed|ajustar\s+ao\s+leito|caber\s+na\s+(mesa|cama|bed))\b/.test(t)) {
    fitBed = true
  }

  return { matched: true, scale, fitBed }
}

/** Preset architectural scales shown in the LSF picker. */
export const LSF_SCALE_PRESETS = [50, 70, 100] as const

export const DEFAULT_LSF_SCALE = 70
export const DEFAULT_LSF_MIN_T_MM = 1.9
