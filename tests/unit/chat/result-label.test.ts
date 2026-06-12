import { describe, it, expect } from 'vitest'
import { resultLabel, type GenerateMeta } from '@/lib/chat/result-label'

describe('resultLabel', () => {
  it('appends mm dims when meta.bbox_mm is present', () => {
    const meta: GenerateMeta = { kind: 'disc', bbox_mm: { x: 40, y: 40, z: 3 } }
    expect(resultLabel(meta)).toBe('Disco / medalha (40×40×3 mm)')
  })

  it('falls back to "Generated" with no dims when bbox_mm is missing', () => {
    expect(resultLabel({ kind: 'disc' })).toBe('Disco / medalha')
  })

  it('does not throw and returns the PT-BR fallback when meta itself is undefined (legacy/meta-less response)', () => {
    expect(resultLabel(undefined)).toBe('Modelo gerado')
  })

  it('labels hollow_cylinder and flat_plate kinds', () => {
    expect(resultLabel({ kind: 'hollow_cylinder', bbox_mm: { x: 70, y: 70, z: 100 } }))
      .toBe('Porta-lata / sleeve (70×70×100 mm)')
    expect(resultLabel({ kind: 'flat_plate', bbox_mm: { x: 50, y: 80, z: 4 } }))
      .toBe('Placa / chaveiro (50×80×4 mm)')
  })
})
