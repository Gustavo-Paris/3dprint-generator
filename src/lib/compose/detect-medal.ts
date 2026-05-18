const TRIGGERS = [
  // pt
  'medalha', 'medalhao', 'medalhão',
  // en
  'medal', 'medallion',
]

export function shouldUseMedalComposer(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
