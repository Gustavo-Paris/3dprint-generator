/** Default title given to projects created without a name (see actions/projects.ts).
 *  Exported so the generate route can detect "still unnamed" and auto-title. */
export const DEFAULT_PROJECT_TITLE = 'Projeto sem título'
const DEFAULT_TITLE = DEFAULT_PROJECT_TITLE
const MAX_LEN = 60

/**
 * Turn a user's first prompt into a short, PT-BR project title.
 * Pure + side-effect free so it's reused by both the create action and the
 * generate route's first-prompt rename. Empty/placeholder prompts → default.
 */
export function deriveProjectTitle(prompt: string | null | undefined): string {
  const firstLine = (prompt ?? '').split('\n')[0].replace(/\s+/g, ' ').trim()
  // '(image only)' is the legacy EN placeholder still present in old history rows.
  if (!firstLine || firstLine === '(image only)' || firstLine === '(apenas imagem)') return DEFAULT_TITLE
  if (firstLine.length <= MAX_LEN) return firstLine
  return firstLine.slice(0, MAX_LEN).trimEnd() + '…'
}
