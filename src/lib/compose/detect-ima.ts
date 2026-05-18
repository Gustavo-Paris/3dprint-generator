const TRIGGERS = [
  // pt
  'imã', 'imá', 'ima', 'iman', 'imán',
  'geladeira', 'porta de geladeira',
  // en
  'magnet', 'fridge magnet', 'refrigerator magnet',
]

export function shouldUseImaComposer(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
