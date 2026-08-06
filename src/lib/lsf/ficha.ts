/**
 * LSF maquete "one-pager" text (Phase D lite) — a printable summary the user
 * can download after generation. Not a full PDF stack: markdown/plain text
 * opens anywhere and is enough for field handoff / Bambu notes.
 */

export type LsfFichaInput = {
  scale: number
  minTMm?: number
  fitBed?: boolean
  ifcName?: string
  meshUrl?: string | null
  meta?: Record<string, unknown> | null
  projectTitle?: string
}

export function buildLsfFichaMarkdown(input: LsfFichaInput): string {
  const scale = input.scale > 0 ? input.scale : 70
  const minT = input.minTMm ?? 1.9
  const fit = input.fitBed !== false
  const metaLines =
    input.meta && typeof input.meta === 'object'
      ? Object.entries(input.meta)
          .filter(([, v]) => v != null && typeof v !== 'object')
          .slice(0, 12)
          .map(([k, v]) => `- ${k}: ${String(v)}`)
      : []

  return [
    '# Ficha — Maquete LSF (esqueleto steel frame)',
    '',
    input.projectTitle ? `**Projeto:** ${input.projectTitle}` : null,
    input.ifcName ? `**IFC:** ${input.ifcName}` : null,
    `**Escala:** 1:${scale}`,
    `**Espessura mínima (minT):** ${minT} mm`,
    `**Fit leito H2D:** ${fit ? 'sim' : 'não'}`,
    input.meshUrl ? `**Malha:** ${input.meshUrl}` : null,
    '',
    '## Impressão (Bambu / Orca)',
    '',
    '- Multi-corpo non-watertight é **esperado** — não force união Manifold.',
    '- Preferir fatiar no Studio (botão Fatiar) ou abrir o 3MF no Bambu Studio.',
    '- Se alguma peça for fina demais, suba minT e regenere a maquete.',
    '- Perfil sugerido: PLA, 0.2 mm, suportes só se o layout exigir.',
    '',
    metaLines.length ? '## Metadados do worker' : null,
    metaLines.length ? '' : null,
    ...metaLines,
    metaLines.length ? '' : null,
    `Gerado em ${new Date().toISOString().slice(0, 10)} · 3dprint-generator LSF`,
    '',
  ]
    .filter((line): line is string => line != null)
    .join('\n')
}
