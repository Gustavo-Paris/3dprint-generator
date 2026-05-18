const TRIGGERS = [
  // pt
  'pingente', 'pendente', 'colar', 'cordão', 'cordao',
  // en
  'pendant', 'necklace charm', 'charm',
]

export function shouldUsePingenteComposer(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
