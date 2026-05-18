/**
 * Parse logo-size intent from the user's natural-language message.
 *
 * Returns the fraction of the host shape (plate width / disc diameter) that
 * the logo should occupy. Sensible defaults so most messages map to the
 * "normal" size.
 */
const BIGGER = /\b(maior|enorme|grande|gigante|grandona|aumenta(?:r)?|crescer?|aumentada)\b/i
const SMALLER = /\b(menor|pequen[oa]?|pequena|diminui(?:r)?|reduzir?|reduzida)\b/i
const MEDIUM = /\b(m[eé]dia?|normal|padr[aã]o)\b/i

export function parseLogoSizeRatio(message: string, defaultRatio = 0.8): number {
  if (BIGGER.test(message)) return 0.95
  if (SMALLER.test(message)) return 0.55
  if (MEDIUM.test(message)) return 0.7
  return defaultRatio
}
