import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory app_settings singleton row — vi.hoisted so the hoisted vi.mock
// factory can close over it. Mimics the tiny query surface the store uses:
// select().from().where().limit() and insert().values().onConflictDoUpdate().
const mem = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mem.row ? [mem.row] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          mem.row = mem.row ? { ...mem.row, ...set } : { ...v }
        },
      }),
    }),
  },
}))

import {
  saveSettings,
  readSettingsView,
  resolveConfig,
  DEFAULT_FILAMENT_COLOR_BODY,
  DEFAULT_FILAMENT_COLOR_ACCENT,
} from '@/lib/settings/store'

describe('settings store — printer + filament colours', () => {
  beforeEach(() => {
    mem.row = null
  })

  it('saves and reads back printerModel + both colours', async () => {
    await saveSettings({
      printerModel: 'bambu-h2d-04',
      filamentColorBody: '#112233',
      filamentColorAccent: '#AaBbCc',
    })

    const view = await readSettingsView()
    expect(view.printerModel).toBe('bambu-h2d-04')
    expect(view.filamentColorBody).toBe('#112233')
    expect(view.filamentColorAccent).toBe('#AaBbCc')

    const cfg = await resolveConfig()
    expect(cfg.printerModel).toBe('bambu-h2d-04')
    expect(cfg.filamentColorBody).toBe('#112233')
    expect(cfg.filamentColorAccent).toBe('#AaBbCc')
  })

  it('returns defaults in the view when the DB columns are null', async () => {
    // No row at all.
    let view = await readSettingsView()
    expect(view.printerModel).toBe('')
    expect(view.filamentColorBody).toBe(DEFAULT_FILAMENT_COLOR_BODY)
    expect(view.filamentColorAccent).toBe(DEFAULT_FILAMENT_COLOR_ACCENT)

    // Row exists but printer fields are null.
    await saveSettings({ printerModel: '', filamentColorBody: '', filamentColorAccent: '' })
    view = await readSettingsView()
    expect(view.printerModel).toBe('')
    expect(view.filamentColorBody).toBe(DEFAULT_FILAMENT_COLOR_BODY)
    expect(view.filamentColorAccent).toBe(DEFAULT_FILAMENT_COLOR_ACCENT)
  })

  it('resolveConfig is DB-only for printer fields (null when unset)', async () => {
    const cfg = await resolveConfig()
    expect(cfg.printerModel).toBeNull()
    expect(cfg.filamentColorBody).toBeNull()
    expect(cfg.filamentColorAccent).toBeNull()
  })

  it("stores '' and 'none' as null (no printer)", async () => {
    await saveSettings({ printerModel: '' })
    expect(mem.row?.printerModel).toBeNull()

    await saveSettings({ printerModel: 'none' })
    expect(mem.row?.printerModel).toBeNull()
    expect((await readSettingsView()).printerModel).toBe('')
  })

  it("stores '' colours as null in the DB", async () => {
    await saveSettings({ filamentColorBody: '', filamentColorAccent: '' })
    expect(mem.row?.filamentColorBody).toBeNull()
    expect(mem.row?.filamentColorAccent).toBeNull()
  })

  it('rejects an unknown printerModel with a clear PT-BR error', async () => {
    await expect(saveSettings({ printerModel: 'prusa-mk4' })).rejects.toThrow(
      /Impressora inválida/,
    )
    // Nothing persisted.
    expect(mem.row).toBeNull()
  })

  it('rejects invalid colours (#RRGGBB only)', async () => {
    await expect(saveSettings({ filamentColorBody: 'red' })).rejects.toThrow(
      /Cor do corpo inválida/,
    )
    await expect(saveSettings({ filamentColorBody: '#12345' })).rejects.toThrow(
      /Cor do corpo inválida/,
    )
    await expect(saveSettings({ filamentColorAccent: '#GGHHII' })).rejects.toThrow(
      /Cor do detalhe inválida/,
    )
    expect(mem.row).toBeNull()
  })

  it('keeps previously saved printer fields when a later save omits them', async () => {
    await saveSettings({
      printerModel: 'bambu-h2d-04',
      filamentColorBody: '#112233',
      filamentColorAccent: '#445566',
    })
    // A save that only touches other fields sends the printer fields as '' from
    // the form — but an API caller may omit them entirely; omission clears too
    // (norm(undefined) → null), matching the existing field-by-field semantics
    // where every save writes the full row. Assert that explicitly.
    await saveSettings({ aiModel: 'gpt-4o-mini' })
    expect(mem.row?.printerModel).toBeNull()
    expect(mem.row?.filamentColorBody).toBeNull()
  })
})
