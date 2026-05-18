/**
 * Detect when the user is asking for a COASTER (porta-copo) composed from
 * their logo. Caller must verify there is a source image.
 */
const TRIGGERS = [
  // pt
  'porta-copo', 'porta copo', 'portacopo', 'porta-copos', 'porta copos',
  'descanso de copo', 'descanso pra copo', 'descanso para copo',
  'bolacha de copo', 'base de copo', 'base para copo',
  // en
  'coaster', 'cup coaster', 'drink coaster', 'beverage coaster',
]

export function shouldUseCoasterComposer(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
