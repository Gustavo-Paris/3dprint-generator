import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parse3mfSliceMeta } from '../../../slicer/src/slice-meta'

function make3mf(sliceInfo: string, gcode?: string): Buffer {
  const files: Record<string, Uint8Array> = {
    'Metadata/slice_info.config': strToU8(sliceInfo),
  }
  if (gcode) files['Metadata/plate_1.gcode'] = strToU8(gcode)
  return Buffer.from(zipSync(files))
}

describe('parse3mfSliceMeta', () => {
  it('reads prediction seconds + filament grams/metres from slice_info.config', () => {
    const buf = make3mf(
      `<?xml version="1.0"?>
<config>
 <plate>
  <metadata key="index" value="1"/>
  <metadata key="prediction" value="5400"/>
  <filament id="1" tray_info_idx="GFL99" type="PLA" used_m="3.21" used_g="9.7"/>
 </plate>
</config>`,
    )
    const meta = parse3mfSliceMeta(buf)
    expect(meta.print_time_min).toBeCloseTo(90, 5) // 5400s → 90min
    expect(meta.filament_g).toBeCloseTo(9.7, 5)
    expect(meta.filament_m).toBeCloseTo(3.21, 5)
  })

  it('falls back to gcode headers when slice_info has no prediction', () => {
    const buf = make3mf(
      `<config><plate></plate></config>`,
      `; total estimated time: 1h 2m 30s\n; filament used [g] : 12.40\n; filament used [mm] : 4100.0\n`,
    )
    const meta = parse3mfSliceMeta(buf)
    expect(meta.print_time_min).toBeCloseTo(62.5, 1) // 1h2m30s
    expect(meta.filament_g).toBeCloseTo(12.4, 5)
    expect(meta.filament_m).toBeCloseTo(4.1, 3) // 4100mm → 4.1m
  })

  it('returns nulls (never throws) when the zip lacks both sources', () => {
    const meta = parse3mfSliceMeta(Buffer.from(zipSync({ 'foo.txt': strToU8('x') })))
    expect(meta).toEqual({ print_time_min: null, filament_g: null, filament_m: null })
  })
})
