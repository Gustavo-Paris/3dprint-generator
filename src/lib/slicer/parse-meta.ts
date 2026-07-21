/**
 * Parse print-time / filament estimates out of an OrcaSlicer output 3MF.
 * Mirrors slicer/src/slice-meta.ts so the Next app can recover meta when the
 * remote slicer returns a valid 3MF but null metadata (older deploy / density-0).
 */
import { unzipSync, strFromU8 } from 'fflate'

export type SliceMeta = {
  print_time_min: number | null
  filament_g: number | null
  filament_m: number | null
}

const EMPTY: SliceMeta = { print_time_min: null, filament_g: null, filament_m: null }

/** Default PLA density (g/cm³) + 1.75 mm diameter — used only when Orca reports
 *  metres of filament but 0 g (common when filament_density is mis-set to 0). */
const DEFAULT_PLA_DENSITY = 1.24
const DEFAULT_FILAMENT_DIAMETER_MM = 1.75

/** OrcaSlicer writes the real estimates into the output 3MF, not stdout. Read
 *  Metadata/slice_info.config first (authoritative), then fall back to the
 *  plate_1.gcode header comments. Never throws — returns nulls on any failure. */
export function parse3mfSliceMeta(zip: Buffer | Uint8Array): SliceMeta {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zip instanceof Buffer ? new Uint8Array(zip) : zip)
  } catch {
    return { ...EMPTY }
  }

  const out: SliceMeta = { ...EMPTY }
  const cfgKey = Object.keys(files).find((k) => k.endsWith('slice_info.config'))
  if (cfgKey) {
    const xml = strFromU8(files[cfgKey])
    const pred = xml.match(/key="prediction"\s+value="([0-9.]+)"/i)
    if (pred) out.print_time_min = Number(pred[1]) / 60
    let g = 0
    let m = 0
    let sawG = false
    let sawM = false
    for (const f of xml.matchAll(/<filament\b[^>]*\/?>/gi)) {
      const tag = f[0]
      const ug = tag.match(/used_g="([0-9.]+)"/i)
      const um = tag.match(/used_m="([0-9.]+)"/i)
      if (ug) {
        g += Number(ug[1])
        sawG = true
      }
      if (um) {
        m += Number(um[1])
        sawM = true
      }
    }
    if (sawG) out.filament_g = g
    if (sawM) out.filament_m = m
  }

  const gKey = Object.keys(files).find((k) => /plate_\d+\.gcode$/i.test(k))
  if (gKey && (out.print_time_min == null || out.filament_g == null || out.filament_m == null)) {
    const head = strFromU8(files[gKey]).slice(0, 8000)
    if (out.print_time_min == null) {
      const t = head.match(/total estimated time:\s*([^\n;]+)/i)
      if (t) out.print_time_min = parseGcodeTimeMin(t[1].trim())
    }
    if (out.filament_g == null) {
      const fg = head.match(/filament used \[g\]\s*:\s*([0-9.]+)/i)
      if (fg) out.filament_g = Number(fg[1])
    }
    if (out.filament_m == null) {
      const fm = head.match(/filament used \[mm\]\s*:\s*([0-9.]+)/i)
      if (fm) out.filament_m = Number(fm[1]) / 1000
    }
  }

  return enrichFilamentMass(out)
}

/** When Orca reports length but 0/null grams (density=0 profile), estimate mass. */
export function enrichFilamentMass(meta: SliceMeta): SliceMeta {
  const m = meta.filament_m
  if (m != null && m > 0 && (meta.filament_g == null || meta.filament_g === 0)) {
    const rMm = DEFAULT_FILAMENT_DIAMETER_MM / 2
    const lengthMm = m * 1000
    const volCm3 = (Math.PI * rMm * rMm * lengthMm) / 1000
    return { ...meta, filament_g: Math.round(volCm3 * DEFAULT_PLA_DENSITY * 100) / 100 }
  }
  return meta
}

/** Prefer remote meta fields when present; fill gaps from the 3MF itself. */
export function coalesceSliceMeta(
  remote: Partial<SliceMeta> | null | undefined,
  zipBytes: Buffer | Uint8Array,
): SliceMeta {
  const parsed = parse3mfSliceMeta(zipBytes)
  const base: SliceMeta = {
    print_time_min: remote?.print_time_min ?? parsed.print_time_min,
    filament_g: remote?.filament_g ?? parsed.filament_g,
    filament_m: remote?.filament_m ?? parsed.filament_m,
  }
  return enrichFilamentMass(base)
}

function parseGcodeTimeMin(s: string): number | null {
  const hms = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const h = Number(hms[1] ?? 0)
    const m = Number(hms[2] ?? 0)
    const sec = Number(hms[3] ?? 0)
    return h * 60 + m + sec / 60
  }
  const bare = Number(s)
  return Number.isFinite(bare) ? bare / 60 : null
}
