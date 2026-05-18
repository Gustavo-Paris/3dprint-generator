const TRIGGERS = [
  // pt
  'plaquinha', 'plaquinha de mesa', 'placa de mesa', 'placa para mesa',
  'plaqueta', 'plaqueta de mesa',
  'porta-nome', 'porta nome', 'nameplate',
  'suporte de mesa', 'display de mesa',
  // en
  'desk plate', 'desk plaque', 'name plate', 'desk sign', 'desk display',
]

export function shouldUsePlaquinhaComposer(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
