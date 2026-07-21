import { describe, it, expect } from 'vitest'
import { buildProjectSettings } from '@/lib/print-profile/build-project-settings'
import { getPrinter, PRINTERS } from '@/lib/print-profile/printers'
import template from '@/lib/print-profile/templates/bbl-h2d-04.json'

const h2d = getPrinter('bambu-h2d-04')
const flat = { multicolor: true, standing: false }
const standing = { multicolor: true, standing: true }

describe('getPrinter', () => {
  it('resolves known ids and falls back to none', () => {
    expect(getPrinter('bambu-h2d-04').hasProfileTemplate).toBe(true)
    expect(getPrinter('none').id).toBe('none')
    expect(getPrinter('nope').id).toBe('none')
    expect(getPrinter(null).id).toBe('none')
    expect(getPrinter(undefined).id).toBe('none')
  })

  it('registry has the two expected printers', () => {
    expect(PRINTERS.map((p) => p.id)).toEqual(['none', 'bambu-h2d-04'])
    expect(PRINTERS[0].hasProfileTemplate).toBe(false)
  })
})

describe('buildProjectSettings', () => {
  it('returns null for a printer without a template', () => {
    expect(buildProjectSettings(getPrinter('none'), flat)).toBeNull()
  })

  it('carries all template keys (558+) plus the overrides', () => {
    const out = buildProjectSettings(h2d, flat)!
    expect(out).not.toBeNull()
    expect(Object.keys(out).length).toBeGreaterThanOrEqual(558)
    for (const key of Object.keys(template)) {
      expect(out).toHaveProperty(key)
    }
  })

  it('applies the tuned overrides as strings', () => {
    const out = buildProjectSettings(h2d, flat)!
    expect(out.layer_height).toBe('0.16')
    expect(out.initial_layer_print_height).toBe('0.2')
    expect(out.bottom_shell_layers).toBe('4')
    expect(out.elefant_foot_compensation).toBe('0.15')
    expect(out.seam_position).toBe('rear')
    expect(out.print_settings_id).toBe('0.16mm Detalhe @3DGen (H2D)')
  })

  it('speed overrides preserve the template array lengths', () => {
    const out = buildProjectSettings(h2d, flat)!
    const tOuter = (template as Record<string, unknown>)
      .outer_wall_speed as string[]
    const tTop = (template as Record<string, unknown>)
      .top_surface_speed as string[]
    expect(out.outer_wall_speed).toEqual(tOuter.map(() => '150'))
    expect(out.top_surface_speed).toEqual(tTop.map(() => '150'))
    expect((out.outer_wall_speed as string[]).length).toBe(tOuter.length)
    expect((out.top_surface_speed as string[]).length).toBe(tTop.length)
  })

  it('standing pieces get an outer brim; flat pieces keep the template brim', () => {
    const up = buildProjectSettings(h2d, standing)!
    expect(up.brim_type).toBe('outer_only')
    expect(up.brim_width).toBe('5')

    const down = buildProjectSettings(h2d, flat)!
    expect(down.brim_type).toBe(
      (template as Record<string, unknown>).brim_type,
    )
  })

  it('uses default colours with slot2=accent, slot3=body', () => {
    const out = buildProjectSettings(h2d, flat)!
    expect(out.filament_colour).toEqual(['#FFFFFFFF', '#22C55E', '#3B82F6'])
  })

  it('custom colours land in filament_colour (same slot order)', () => {
    const out = buildProjectSettings(h2d, flat, {
      bodyHex: '#112233',
      accentHex: '#AABBCC',
    })!
    expect(out.filament_colour).toEqual(['#FFFFFFFF', '#AABBCC', '#112233'])
  })

  it('never mutates the imported template across calls', () => {
    const before = JSON.stringify(template)
    const first = buildProjectSettings(h2d, standing, {
      bodyHex: '#000000',
      accentHex: '#FF0000',
    })!
    buildProjectSettings(h2d, flat, {
      bodyHex: '#111111',
      accentHex: '#222222',
    })
    expect(JSON.stringify(template)).toBe(before)
    // First result is also untouched by the second call.
    expect(first.filament_colour).toEqual(['#FFFFFFFF', '#FF0000', '#000000'])
    expect(first.brim_type).toBe('outer_only')
  })

  it('serializes to valid JSON under 200KB', () => {
    const out = buildProjectSettings(h2d, standing)!
    const json = JSON.stringify(out)
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json.length).toBeLessThan(200 * 1024)
  })
})
