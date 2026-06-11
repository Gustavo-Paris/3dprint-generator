import { unzipSync, strFromU8 } from 'fflate'

export type SliceMeta = {
  print_time_min: number | null
  filament_g: number | null
  filament_m: number | null
}

const EMPTY: SliceMeta = { print_time_min: null, filament_g: null, filament_m: null }

/** OrcaSlicer writes the real estimates into the output 3MF, not stdout. Read
 *  Metadata/slice_info.config first (authoritative), then fall back to the
 *  plate_1.gcode header comments. Never throws — returns nulls on any failure. */
export function parse3mfSliceMeta(zip: Buffer): SliceMeta {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(zip))
  } catch {
    return { ...EMPTY }
  }

  const out: SliceMeta = { ...EMPTY }
  const cfgKey = Object.keys(files).find((k) => k.endsWith('slice_info.config'))
  if (cfgKey) {
    const xml = strFromU8(files[cfgKey])
    const pred = xml.match(/key="prediction"\s+value="([0-9.]+)"/i)
    if (pred) out.print_time_min = Number(pred[1]) / 60
    let g = 0, m = 0, sawG = false, sawM = false
    for (const f of xml.matchAll(/<filament\b[^>]*\/?>/gi)) {
      const tag = f[0]
      const ug = tag.match(/used_g="([0-9.]+)"/i)
      const um = tag.match(/used_m="([0-9.]+)"/i)
      if (ug) { g += Number(ug[1]); sawG = true }
      if (um) { m += Number(um[1]); sawM = true }
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
  return out
}

function parseGcodeTimeMin(s: string): number | null {
  const hms = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const h = Number(hms[1] ?? 0), m = Number(hms[2] ?? 0), sec = Number(hms[3] ?? 0)
    return h * 60 + m + sec / 60
  }
  const bare = Number(s)
  return Number.isFinite(bare) ? bare / 60 : null
}
