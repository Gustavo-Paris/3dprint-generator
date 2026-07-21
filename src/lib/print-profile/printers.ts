/**
 * Printer registry for the print-profile layer.
 *
 * Each entry maps a user-selectable printer to the vendored Bambu Studio
 * project_settings template (when one exists). `none` is the explicit
 * "no printer configured" default — exports stay profile-less.
 */

export type PrinterId = 'none' | 'bambu-h2d-04'

export interface PrinterDef {
  id: PrinterId
  label: string
  nozzleMm: number
  hasProfileTemplate: boolean
}

export const PRINTERS: readonly PrinterDef[] = [
  { id: 'none', label: 'Nenhuma', nozzleMm: 0.4, hasProfileTemplate: false },
  {
    id: 'bambu-h2d-04',
    label: 'Bambu Lab H2D · 0.4',
    nozzleMm: 0.4,
    hasProfileTemplate: true,
  },
]

/** Resolve a stored printer id; unknown/null/undefined fall back to 'none'. */
export function getPrinter(id: string | null | undefined): PrinterDef {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS[0]
}
