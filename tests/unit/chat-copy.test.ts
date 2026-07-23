import { describe, it, expect } from 'vitest'
import { examplePromptsFor, designDetails } from '@/components/Chat'

describe('examplePromptsFor', () => {
  it('shows from-scratch prompts when there is no imported base', () => {
    const chips = examplePromptsFor(false)
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.join(' ')).toContain('Porta-lata')
  })

  it('switches to edit examples when the project has an imported base', () => {
    const chips = examplePromptsFor(true)
    expect(chips).toContain('aumenta 20%')
    expect(chips).toContain('furo de 5mm no topo')
    expect(chips).toContain('texto "MARCI" em relevo na frente')
    expect(chips).toContain('pinta o topo de verde')
    expect(chips.join(' ')).not.toContain('Porta-lata')
  })
})

describe('designDetails (human summary — no raw JSON in the disclosure)', () => {
  it('summarizes a flat plate with dimensions', () => {
    const lines = designDetails({ kind: 'flat_plate', widthMm: 80, heightMm: 40, thicknessMm: 3 })
    expect(lines[0]).toBe('Tipo: Placa')
    expect(lines[1]).toContain('80×40×3mm')
  })

  it('includes the logo treatment in PT-BR when present', () => {
    const lines = designDetails({
      kind: 'disc',
      diameterMm: 50,
      thicknessMm: 4,
      logo: { treatment: 'engraved', sizeRatio: 0.6 },
    })
    expect(lines.join(' · ')).toContain('gravado')
    expect(lines.join(' · ')).toContain('60%')
  })

  it('summarizes imported designs by edit count', () => {
    const lines = designDetails({
      kind: 'imported',
      baseMeshUrl: '/x.3mf',
      edits: [{ op: 'scale' }, { op: 'paint_region' }],
    })
    expect(lines[0]).toContain('importada')
    expect(lines[1]).toBe('Edições aplicadas: 2')
  })

  it('returns [] for non-object designs', () => {
    expect(designDetails(null)).toEqual([])
    expect(designDetails('x')).toEqual([])
  })
})
