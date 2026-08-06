/**
 * Build a Bambu Studio `Metadata/project_settings.config` payload for a piece.
 *
 * Starts from the vendored full-dump template (bbl-h2d-04.json — a complete,
 * validated project_settings.config from Bambu Studio 02.06.00.51 for the H2D
 * with 0.4 nozzle) and applies a small set of overrides tuned for the pieces
 * this app generates (flat pendants/medallions). All override values are
 * strings, matching the slicer's own config format.
 */

import type { PrinterDef } from './printers'
import template from './templates/bbl-h2d-04.json'

export interface PieceTraits {
  /**
   * Whether the piece uses more than one filament slot. Today this changes
   * NOTHING beyond the colours (filament_colour is always written with the
   * 3-slot layout below); it stays in the contract so callers declare intent
   * and future profiles can branch on it (e.g. prime tower / flush tuning).
   */
  multicolor: boolean
  /** Piece will be printed standing on its thin edge (see orient.ts). */
  standing: boolean
  /**
   * Light Steel Frame maquete (multi-body IFC skeleton). Overrides process
   * keys from the SteelPrime golden project:
   * `docs/references/steelprime-lsf/golden-recipe.json`
   */
  lsfMaquette?: boolean
}

export interface ProfileColors {
  /** '#RRGGBB' */
  bodyHex: string
  /** '#RRGGBB' */
  accentHex: string
}

const DEFAULT_ACCENT_HEX = '#22C55E'
const DEFAULT_BODY_HEX = '#3B82F6'

/** Replace every element of a template speed array with `value`, keeping the
 *  original length (the slicer indexes these arrays per-filament-slot). */
function fillSpeedArray(templateValue: unknown, value: string): string[] {
  return Array.isArray(templateValue)
    ? templateValue.map(() => value)
    : [value]
}

export function buildProjectSettings(
  printer: PrinterDef,
  piece: PieceTraits,
  colors?: ProfileColors,
): Record<string, unknown> | null {
  if (!printer.hasProfileTemplate) return null

  // Deep-clone: the imported template module is shared — never mutate it.
  const settings = structuredClone(template) as Record<string, unknown>

  const accentHex = colors?.accentHex ?? DEFAULT_ACCENT_HEX
  const bodyHex = colors?.bodyHex ?? DEFAULT_BODY_HEX

  // Slot layout slot1=white base / slot2=accent / slot3=body reproduces a
  // project validated in production — do not "fix" the order.
  settings.filament_colour = ['#FFFFFFFF', accentHex, bodyHex]

  settings.layer_height = '0.16'
  settings.initial_layer_print_height = '0.2'
  settings.bottom_shell_layers = '4'
  // "elefant" spelling is the slicer's own key — do not correct it.
  settings.elefant_foot_compensation = '0.15'
  settings.seam_position = 'rear'
  settings.outer_wall_speed = fillSpeedArray(settings.outer_wall_speed, '150')
  settings.top_surface_speed = fillSpeedArray(settings.top_surface_speed, '150')
  settings.print_settings_id = '0.16mm Detalhe @3DGen (H2D)'

  if (piece.standing) {
    settings.brim_type = 'outer_only'
    settings.brim_width = '5'
  }

  // SteelPrime LSF GOLDEN FINAL (2026-08-05) — docs/references/steelprime-lsf/
  if (piece.lsfMaquette) {
    settings.layer_height = '0.24'
    settings.initial_layer_print_height = '0.2'
    settings.wall_loops = '3'
    settings.top_shell_layers = '4'
    settings.bottom_shell_layers = '3'
    settings.sparse_infill_density = '15%'
    settings.sparse_infill_pattern = 'grid'
    settings.line_width = '0.42'
    settings.inner_wall_line_width = '0.42'
    settings.outer_wall_line_width = '0.42'
    settings.support_line_width = '0.42'
    settings.initial_layer_line_width = '0.5'
    settings.brim_type = 'outer_only'
    settings.brim_width = '8'
    settings.enable_support = '1'
    settings.support_type = 'tree(auto)'
    settings.support_on_build_plate_only = '0'
    settings.support_threshold_angle = '25'
    settings.support_interface_top_layers = '2'
    settings.tree_support_branch_diameter = '2'
    settings.tree_support_branch_distance = '5'
    settings.detect_thin_wall = '1'
    settings.resolution = '0.02'
    settings.print_sequence = 'by layer'
    settings.elefant_foot_compensation = '0.1'
    settings.print_settings_id = '0.24mm Standard @BBL H2D - LSF PRINTABLE'
    settings.outer_wall_speed = fillSpeedArray(settings.outer_wall_speed, '200')
    settings.inner_wall_speed = fillSpeedArray(settings.inner_wall_speed, '300')
    settings.sparse_infill_speed = fillSpeedArray(settings.sparse_infill_speed, '350')
    settings.support_speed = fillSpeedArray(settings.support_speed, '150')
    settings.initial_layer_speed = fillSpeedArray(settings.initial_layer_speed, '50')
  }

  return settings
}
