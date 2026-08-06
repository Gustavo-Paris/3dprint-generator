/**
 * Client-side progress labels for the long IFC → LSF worker job.
 * The API is still a single long request; stages are elapsed-time heuristics
 * so the operator sees motion during ~15s–2min runs.
 */

export type LsfProgressStage = {
  /** Elapsed seconds at which this label becomes active. */
  atSec: number
  label: string
}

export const LSF_PROGRESS_STAGES: readonly LsfProgressStage[] = [
  { atSec: 0, label: 'Carregando IFC…' },
  { atSec: 2, label: 'Tessellando membros LSF…' },
  { atSec: 6, label: 'Espessando seções (≥1.9 mm)…' },
  { atSec: 12, label: 'Montando 3MF com perfil H2D…' },
  { atSec: 25, label: 'Ainda processando — IFCs grandes levam 1–2 min…' },
  { atSec: 60, label: 'Quase lá — finalizando geometria…' },
] as const

export function lsfProgressLabel(elapsedSec: number): string {
  let label = LSF_PROGRESS_STAGES[0].label
  for (const s of LSF_PROGRESS_STAGES) {
    if (elapsedSec >= s.atSec) label = s.label
  }
  return label
}
