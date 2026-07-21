import { describe, it, expect } from 'vitest'
import { tryQuickPaintImport, isMultiColorRequest } from '@/lib/design/quick-paint-import'

describe('tryQuickPaintImport', () => {
  it('uses paint_from_image when a reference image is attached', () => {
    const d = tryQuickPaintImport(
      'quero pintar partes específicas do modelo de outra cor',
      '/meshes/base.3mf',
      null,
      { hasReferenceImage: true },
    )
    expect(d!.edits).toEqual([{ op: 'paint_from_image', view: 'front' }])
  })

  it('prefers image paint over geometric half-split', () => {
    const d = tryQuickPaintImport(
      'quero colocar mais que uma cor no modelo',
      '/m.3mf',
      null,
      { hasReferenceImage: true },
    )
    expect(d!.edits[0].op).toBe('paint_from_image')
  })

  it('falls back to upper_half without image (vague multi-cor)', () => {
    const d = tryQuickPaintImport(
      'quero colocar mais que uma cor no modelo',
      '/meshes/base.3mf',
      null,
      { hasReferenceImage: false },
    )
    expect(d!.edits).toEqual([
      { op: 'paint_region', extruder: 'B', region: 'upper_half' },
    ])
  })

  it('maps capacete/topo to upper_half without image', () => {
    const d = tryQuickPaintImport('capacete dourado multi-cor', '/m.3mf', null)
    expect(d!.edits[0]).toMatchObject({ region: 'upper_half', extruder: 'B' })
  })

  it('resets to single colour', () => {
    const d = tryQuickPaintImport('voltar tudo pra uma cor só', '/m.3mf', {
      kind: 'imported',
      baseMeshUrl: '/m.3mf',
      edits: [{ op: 'paint_from_image', view: 'front' }],
    })
    expect(d!.edits).toEqual([{ op: 'paint_region', extruder: 'A', region: 'all' }])
  })

  it('keeps prior non-paint edits when applying image paint', () => {
    const d = tryQuickPaintImport(
      'pintar com a imagem',
      '/m.3mf',
      {
        kind: 'imported',
        baseMeshUrl: '/prior.3mf',
        edits: [
          { op: 'scale', factor: 0.5 },
          { op: 'paint_region', extruder: 'B', region: 'lower_half' },
        ],
      },
      { hasReferenceImage: true },
    )
    expect(d!.baseMeshUrl).toBe('/prior.3mf')
    expect(d!.edits).toEqual([
      { op: 'scale', factor: 0.5 },
      { op: 'paint_from_image', view: 'front' },
    ])
  })

  it('returns null for unrelated messages', () => {
    expect(tryQuickPaintImport('fura um buraco de 5mm', '/m.3mf', null)).toBeNull()
  })
})

describe('isMultiColorRequest', () => {
  it('detects multi-cor and image-paint phrases', () => {
    expect(isMultiColorRequest('multi-cor por favor')).toBe(true)
    expect(isMultiColorRequest('partes específicas de outra cor')).toBe(true)
    expect(isMultiColorRequest('scale 2x')).toBe(false)
  })
})
