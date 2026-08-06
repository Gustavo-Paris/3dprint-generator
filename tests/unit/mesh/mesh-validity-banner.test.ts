import { describe, it, expect } from 'vitest'
import { meshValidityBanner, type MeshValidityReport } from '@/lib/mesh/validity'

function report(over: Partial<MeshValidityReport>): MeshValidityReport {
  return {
    triangleCount: 100,
    analyzed: true,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    degenerateTriangles: 0,
    nonFiniteTriangles: 0,
    watertight: true,
    ...over,
  }
}

describe('meshValidityBanner', () => {
  it('hides for watertight, unanalyzed, or null reports', () => {
    expect(meshValidityBanner(report({ watertight: true })).show).toBe(false)
    expect(meshValidityBanner(report({ analyzed: false, watertight: false })).show).toBe(false)
    expect(meshValidityBanner(null).show).toBe(false)
  })

  it('treats boundary holes (the parametric plate+hole case) as an info note, not an alarm', () => {
    const b = meshValidityBanner(report({ watertight: false, boundaryEdges: 88 }))
    expect(b).toEqual({
      show: true,
      tone: 'info',
      title: 'Pequenas aberturas na malha',
      detail: 'o slicer ajusta automaticamente ao imprimir.',
    })
  })

  it('warns only for genuinely unprintable non-finite coordinates', () => {
    const b = meshValidityBanner(report({ watertight: false, nonFiniteTriangles: 3, boundaryEdges: 10 }))
    expect(b.show).toBe(true)
    if (b.show) {
      expect(b.tone).toBe('warn')
      expect(b.title).toMatch(/coordenadas inválidas/)
    }
  })

  it('LSF multi-body: expected non-watertight is info, not hole alarm', () => {
    const b = meshValidityBanner(
      report({ watertight: false, boundaryEdges: 50_000, nonManifoldEdges: 200 }),
      { expectMultiBody: true },
    )
    expect(b).toEqual({
      show: true,
      tone: 'info',
      title: 'Maquete LSF multi-corpo',
      detail:
        'aberturas entre membros são esperadas; perfil H2D usa tree support + brim.',
    })
  })

  it('LSF multi-body still warns on non-finite coordinates', () => {
    const b = meshValidityBanner(
      report({ watertight: false, nonFiniteTriangles: 2, boundaryEdges: 100 }),
      { expectMultiBody: true },
    )
    expect(b.show).toBe(true)
    if (b.show) expect(b.tone).toBe('warn')
  })

  it('LSF multi-body shows calm note even when analysis was skipped', () => {
    const b = meshValidityBanner(report({ analyzed: false }), { expectMultiBody: true })
    expect(b.show).toBe(true)
    if (b.show) expect(b.title).toMatch(/LSF/)
  })
})
