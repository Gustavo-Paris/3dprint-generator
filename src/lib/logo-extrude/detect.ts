/**
 * Detect when the user wants the logo-extrude pipeline instead of Meshy.
 *
 * Triggered by keywords that imply "take MY logo as-is and extrude it":
 *  - "logo extrudada", "extrudar a logo", "extrude the logo"
 *  - "letras vazadas" (combined with a source image in scope)
 *  - "logo PG", "minha logo" + "3d"
 *  - "placa da logo", "logo plate"
 *
 * The caller MUST also verify there's a source image available — without
 * one, this pipeline has nothing to vectorize.
 */
const TRIGGERS = [
  // pt
  'logo extrudada', 'extrudar a logo', 'extrudar logo',
  'logo vazada', 'letras vazadas',
  'placa da logo', 'placa com a logo',
  'logo em 3d', 'logo 3d',
  'minha logo em', 'a logo em',
  // en
  'extrude the logo', 'logo extrusion', 'extruded logo',
  'logo plate', 'logo plaque',
  'hollow letters',
]

export function shouldUseLogoExtrude(text: string): boolean {
  const lower = text.toLowerCase()
  return TRIGGERS.some((t) => lower.includes(t))
}
