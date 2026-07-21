/** Public surface of the print-profile layer (printer registry, Bambu
 *  project_settings builder, standing-orientation planner). */
export { PRINTERS, getPrinter } from './printers'
export type { PrinterId, PrinterDef } from './printers'
export { buildProjectSettings } from './build-project-settings'
export type { PieceTraits, ProfileColors } from './build-project-settings'
export { planStandingOrientation } from './orient'
export type { OrientationPlan } from './orient'
