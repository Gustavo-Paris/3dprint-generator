/**
 * Home "Comece por um modelo" gallery — each preset creates a project and
 * opens the studio with the seed prompt pre-filled (rm-013).
 */
export type StarterPreset = {
  id: string
  title: string
  prompt: string
  emoji: string
  blurb: string
}

export const STARTER_PRESETS: readonly StarterPreset[] = [
  {
    id: 'keychain',
    title: 'Chaveiro com logo',
    prompt: 'Chaveiro retangular 40×20mm com meu logo gravado',
    emoji: '🔑',
    blurb: 'Placa + furo + logo',
  },
  {
    id: 'medal',
    title: 'Medalha / disco',
    prompt: 'Disco de 50mm com logo gravado no centro',
    emoji: '🏅',
    blurb: 'Disco ⌀50mm',
  },
  {
    id: 'sleeve',
    title: 'Porta-lata',
    prompt: 'Porta-lata cilíndrico com meu logo em relevo',
    emoji: '🥤',
    blurb: 'Cilindro oco + logo',
  },
  {
    id: 'plate',
    title: 'Plaquinha de mesa',
    prompt: 'Plaquinha de mesa 80×40mm com furo de pendurar',
    emoji: '🏷️',
    blurb: 'Placa plana',
  },
  {
    id: 'freeform',
    title: 'Personagem freeform',
    prompt: 'Um polvo fofo estilo brinquedo articulado (freeform)',
    emoji: '🐙',
    blurb: 'Meshy + articula',
  },
  {
    id: 'lsf',
    title: 'Maquete LSF',
    prompt: 'Maquete LSF a partir de IFC escala 1:70',
    emoji: '🏗️',
    blurb: 'IFC → steel frame',
  },
] as const

export function findPreset(id: string): StarterPreset | undefined {
  return STARTER_PRESETS.find((p) => p.id === id)
}

/** Short PT-BR label for strategy/kind on project cards. */
export function kindLabelForStrategy(strategy: string | null | undefined): string | null {
  if (!strategy || strategy === 'generative' || strategy === 'parametric') return null
  const map: Record<string, string> = {
    hollow_cylinder: 'Porta-lata',
    flat_plate: 'Placa',
    disc: 'Disco',
    box: 'Caixa',
    bookmark: 'Marca-página',
    pin: 'Pin',
    custom_keychain: 'Chaveiro',
    mug: 'Caneca',
    composite: 'Composto',
    imported: 'Importado',
    freeform: 'Freeform',
    flexified: 'Flexi',
    parametric_code: 'JSCAD',
    lsf_maquette: 'LSF',
  }
  return map[strategy] ?? strategy
}
