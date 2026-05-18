/**
 * Keywords that EXPLICITLY ask for a separate base/pedestal under the mesh.
 *
 * Note: "trofeu/trophy/award/prize" are deliberately NOT here — those words
 * describe the whole object the user wants printed, not a separate pedestal
 * underneath it. A trophy can perfectly well be a single vertical sculpture
 * with no detached base. Forcing a base on every "trofeu" mention surprises
 * the user and visually flattens the Meshy output (the compose step shrinks
 * the top mesh to fit the base diameter).
 */
const KEYWORDS = [
  // pt — phrases that name a base/pedestal as a separate piece
  'pedestal', 'pódio', 'podio', 'plinto',
  'com base', 'com pedestal', 'com pódio', 'com podio',
  'numa base', 'num pedestal', 'num pódio', 'num podio',
  'em uma base', 'em um pedestal',
  'sobre uma base', 'sobre um pedestal',
  'monta na base', 'montado numa base', 'em cima de uma base',
  // en
  'pedestal', 'plinth', 'podium',
  'on a base', 'on a pedestal', 'on a plinth', 'on a podium',
  'with a base', 'with a pedestal',
  'mounted on a base', 'mounted on a pedestal',
]

/**
 * Phrases that veto a base, even if a positive keyword also appears.
 * Order matters less than coverage — match common variants of "no base please".
 */
const NEGATIVE = [
  // pt
  'sem base', 'sem essa base', 'sem aquela base', 'sem o pedestal', 'sem pedestal',
  'sem pódio', 'sem podio',
  'não quero base', 'nao quero base', 'não quero a base', 'nao quero a base',
  'não quero pedestal', 'nao quero pedestal',
  'tira a base', 'tirar a base', 'remove a base', 'remover a base',
  'apenas a logo', 'só a logo', 'so a logo', 'somente a logo',
  // en
  'no base', 'no pedestal', 'without base', 'without a base',
  'without pedestal', 'without a pedestal',
  'remove the base', 'drop the base',
  'just the logo', 'only the logo',
]

/**
 * Decide whether to compose a separate pedestal under the generated mesh.
 *
 * Default: `mesh_only` — never surprise the user with a base they didn't ask for.
 * `with_base` only when the user explicitly mentions a base/pedestal/podium as
 * a separate element, AND no negation phrase is present.
 */
export function detectBaseMode(text: string): 'mesh_only' | 'with_base' {
  const lower = text.toLowerCase()
  if (NEGATIVE.some((n) => lower.includes(n))) return 'mesh_only'
  if (KEYWORDS.some((k) => lower.includes(k))) return 'with_base'
  return 'mesh_only'
}
