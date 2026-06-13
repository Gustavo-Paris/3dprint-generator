import { describe, it, expect } from 'vitest'
import { sanitizeDesign } from '@/lib/design/sanitize'
import { Design } from '@/lib/design/schema'

describe('sanitizeDesign — hollow_cylinder', () => {
  it('clamps an unprintable wall up to 1.5mm minimum', () => {
    const input = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 100, wallMm: 0.5, baseMm: 3,
    })
    const { design, adjustments } = sanitizeDesign(input)
    expect((design as { wallMm: number }).wallMm).toBe(1.5)
    expect(adjustments).toContainEqual({ field: 'wallMm', from: 0.5, to: 1.5 })
  })

  it('clamps an absurd height down to 250mm', () => {
    const input = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 5000, wallMm: 3, baseMm: 3,
    })
    const { design, adjustments } = sanitizeDesign(input)
    expect((design as { heightMm: number }).heightMm).toBe(250)
    expect(adjustments).toContainEqual({ field: 'heightMm', from: 5000, to: 250 })
  })

  it('passes through values in range without adjustments', () => {
    const input = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 100, wallMm: 3, baseMm: 3,
    })
    const { adjustments } = sanitizeDesign(input)
    expect(adjustments).toEqual([])
  })

  it('clamps handle finger hole that is too small for a finger', () => {
    const input = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 100, wallMm: 3, baseMm: 3,
      handle: { heightMm: 60, stickOutMm: 28, thicknessMm: 8, fingerHoleDiameterMm: 3 },
    })
    const { design, adjustments } = sanitizeDesign(input)
    const handle = (design as { handle: { fingerHoleDiameterMm: number } }).handle
    expect(handle.fingerHoleDiameterMm).toBe(10)
    expect(adjustments).toContainEqual({
      field: 'handle.fingerHoleDiameterMm',
      from: 3,
      to: 10,
    })
  })
})

describe('sanitizeDesign — box', () => {
  it('clamps an absurd dimension down to 250mm', () => {
    const input = Design.parse({ kind: 'box', widthMm: 9000, depthMm: 30, heightMm: 30 })
    const { design, adjustments } = sanitizeDesign(input)
    expect((design as { widthMm: number }).widthMm).toBe(250)
    expect(adjustments).toContainEqual({ field: 'widthMm', from: 9000, to: 250 })
  })

  it('clamps corner radius to half the smallest dim', () => {
    const input = Design.parse({ kind: 'box', widthMm: 40, depthMm: 40, heightMm: 10, cornerRadiusMm: 30 })
    const { design } = sanitizeDesign(input)
    // smallest dim is heightMm=10 → max radius 5
    expect((design as { cornerRadiusMm: number }).cornerRadiusMm).toBe(5)
  })

  it('passes a sane cube through unchanged', () => {
    const input = Design.parse({ kind: 'box', widthMm: 30, depthMm: 30, heightMm: 30, cornerRadiusMm: 0 })
    const { adjustments } = sanitizeDesign(input)
    expect(adjustments).toEqual([])
  })
})

describe('sanitizeDesign — flat_plate', () => {
  it('clamps corner radius that exceeds half the smallest dim', () => {
    const input = Design.parse({
      kind: 'flat_plate',
      widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 25,
    })
    // cornerMax = min(60, 30) / 2 = 15
    const { design, adjustments } = sanitizeDesign(input)
    expect((design as { cornerRadiusMm: number }).cornerRadiusMm).toBe(15)
    expect(adjustments).toContainEqual({ field: 'cornerRadiusMm', from: 25, to: 15 })
  })

  it('clamps stand angle above 60° down', () => {
    const input = Design.parse({
      kind: 'flat_plate',
      widthMm: 80, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 2,
      standAngleDeg: 89,
    })
    const { design, adjustments } = sanitizeDesign(input)
    expect((design as { standAngleDeg: number }).standAngleDeg).toBe(60)
    // Schema transform clamps 89 → 80 at parse time; sanitize then clamps 80 → 60.
    expect(adjustments).toContainEqual({ field: 'standAngleDeg', from: 80, to: 60 })
  })
})

describe('sanitizeDesign — disc', () => {
  it('clamps hanging ring inner to be strictly smaller than outer', () => {
    const input = Design.parse({
      kind: 'disc', diameterMm: 50, thicknessMm: 4,
      hangingRing: { outerDiameterMm: 8, innerDiameterMm: 8 },
    })
    const { design, adjustments } = sanitizeDesign(input)
    const ring = (design as { hangingRing: { innerDiameterMm: number; outerDiameterMm: number } }).hangingRing
    expect(ring.outerDiameterMm).toBe(8)
    expect(ring.innerDiameterMm).toBeLessThan(ring.outerDiameterMm)
    expect(adjustments.some((a) => a.field === 'hangingRing.innerDiameterMm')).toBe(true)
  })
})

describe('sanitizeDesign — logo depth', () => {
  it('clamps logo depth too thin to 0.5mm', () => {
    const input = Design.parse({
      kind: 'disc', diameterMm: 50, thicknessMm: 4,
      logo: { treatment: 'engraved', position: 'top_face', sizeRatio: 0.6, depthMm: 0.1 },
    })
    const { design, adjustments } = sanitizeDesign(input)
    expect((design as { logo: { depthMm: number } }).logo.depthMm).toBe(0.5)
    expect(adjustments).toContainEqual({ field: 'logo.depthMm', from: 0.1, to: 0.5 })
  })
})

