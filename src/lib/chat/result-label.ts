export type GenerateMeta = {
  kind?: string
  bbox_mm?: { x: number; y: number; z: number }
}

const LABEL_BY_KIND: Record<string, string> = {
  hollow_cylinder: 'Porta-lata / sleeve',
  flat_plate: 'Placa / chaveiro',
  disc: 'Disco / medalha',
  box: 'Caixa / cubo',
  bookmark: 'Marca-página',
  pin: 'Pin / botão',
  custom_keychain: 'Chaveiro',
  mug: 'Caneca',
  composite: 'Modelo composto',
  imported: 'Malha importada',
  freeform: 'Modelo freeform',
  flexified: 'Modelo articulado (flexi)',
  parametric_code: 'Modelo JSCAD',
  lsf_maquette: 'Maquete LSF',
}

/** Human label + mm dims for the chat assistant bubble. Tolerates a missing
 * `meta` or `bbox_mm` (legacy/meta-less responses) instead of throwing. */
export function resultLabel(meta: GenerateMeta | undefined): string {
  const bb = meta?.bbox_mm
  const dims = bb ? ` (${bb.x.toFixed(0)}×${bb.y.toFixed(0)}×${bb.z.toFixed(0)} mm)` : ''
  const base = (meta?.kind && LABEL_BY_KIND[meta.kind]) ?? 'Modelo gerado'
  return `${base}${dims}`
}
