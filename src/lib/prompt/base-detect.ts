const KEYWORDS = [
  // pt (common typos included)
  'troféu', 'trofeu', 'trofer', 'trofeo', 'troféo', 'trofey',
  'prêmio', 'premio',
  'pedestal', 'base', 'suporte', 'pódio', 'podio',
  // en
  'trophy', 'trohpy', 'trofy', 'prize', 'pedestal', 'stand', 'plinth', 'mount', 'award',
]

const NEGATIVE = [
  'sem base', 'no base', 'apenas a logo', 'just the logo', 'só a logo', 'so a logo',
]

/**
 * Decide whether to add a trophy base under the image-generated mesh.
 * Default: `mesh_only` — don't surprise the user with a base they didn't ask for.
 * `with_base` only when keywords like "troféu/trophy/pedestal" appear AND no
 * explicit negation ("sem base", "no base").
 */
export function detectBaseMode(text: string): 'mesh_only' | 'with_base' {
  const lower = text.toLowerCase()
  if (NEGATIVE.some((n) => lower.includes(n))) return 'mesh_only'
  if (KEYWORDS.some((k) => lower.includes(k))) return 'with_base'
  return 'mesh_only'
}
