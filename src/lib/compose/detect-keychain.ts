/**
 * Detect when the user is asking for a KEYCHAIN composed from their logo.
 *
 * Triggers when the message contains an explicit keychain word. We do NOT
 * trigger on vague things like "minha logo" because the user may want a
 * trophy or a plaque or anything else — Meshy handles those. Keychain has
 * a deterministic shape (logo silhouette + ring tab), so we own that case.
 *
 * Caller is responsible for verifying that a source image exists.
 */
const TRIGGERS = [
  // pt
  'chaveiro', 'chaveirinho', 'chaveirim', 'chaveiros',
  // en
  'keychain', 'key chain', 'key-chain', 'key ring', 'keyring', 'key fob',
]

export function shouldUseKeychainComposer(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
