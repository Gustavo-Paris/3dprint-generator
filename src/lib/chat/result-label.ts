export type GenerateMeta = {
  kind?: 'hollow_cylinder' | 'flat_plate' | 'disc'
  bbox_mm?: { x: number; y: number; z: number }
}

const LABEL_BY_KIND: Record<string, string> = {
  hollow_cylinder: 'Porta-lata / sleeve',
  flat_plate: 'Placa / chaveiro',
  disc: 'Disco / medalha',
}

/** Human label + mm dims for the chat assistant bubble. Tolerates a missing
 * `meta` or `bbox_mm` (legacy/meta-less responses) instead of throwing. */
export function resultLabel(meta: GenerateMeta | undefined): string {
  const bb = meta?.bbox_mm
  const dims = bb ? ` (${bb.x.toFixed(0)}×${bb.y.toFixed(0)}×${bb.z.toFixed(0)} mm)` : ''
  const base = (meta?.kind && LABEL_BY_KIND[meta.kind]) ?? 'Modelo gerado'
  return `${base}${dims}`
}
