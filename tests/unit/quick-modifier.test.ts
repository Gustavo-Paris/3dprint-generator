import { describe, it, expect } from 'vitest'
import { tryQuickModify } from '@/lib/design/quick-modifier'
import { Design } from '@/lib/design/schema'

const keychain = Design.parse({
  kind: 'flat_plate',
  widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 4,
  orientation: 'flat',
  hangingHole: { diameterMm: 5, position: 'top' },
  logo: { treatment: 'through_cut', position: 'top_face', sizeRatio: 0.5 },
}) as Extract<Design, { kind: 'flat_plate' }>

const cup = Design.parse({
  kind: 'hollow_cylinder',
  insideDiameterMm: 60, heightMm: 100, wallMm: 3, baseMm: 3,
  logo: { treatment: 'through_cut', position: 'front_face', sizeRatio: 0.5 },
}) as Extract<Design, { kind: 'hollow_cylinder' }>

describe('tryQuickModify — logo size', () => {
  it('"logo maior" bumps sizeRatio +0.15', () => {
    const out = tryQuickModify('aumenta a logo', keychain)
    expect(out).not.toBeNull()
    const logo = (out as Extract<Design, { kind: 'flat_plate' }>).logo
    expect(logo!.sizeRatio).toBeCloseTo(0.65, 2)
  })

  it('"logo menor" reduces sizeRatio', () => {
    const out = tryQuickModify('logo menor', keychain)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).logo!.sizeRatio).toBeCloseTo(0.35, 2)
  })

  it('caps at 0.95 max', () => {
    const big = { ...keychain, logo: { ...keychain.logo!, sizeRatio: 0.9 } } as Design
    const out = tryQuickModify('logo maior', big)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).logo!.sizeRatio).toBe(0.95)
  })

  it('returns null when already at max', () => {
    const maxed = { ...keychain, logo: { ...keychain.logo!, sizeRatio: 0.95 } } as Design
    expect(tryQuickModify('logo maior', maxed)).toBeNull()
  })

  it.each([
    'aumenta mais',
    'ainda maior',
    'muito maior',
    'aumenta um pouco',
    'maior',
    'bem maior',
  ])('"%s" bumps logo up', (msg) => {
    const out = tryQuickModify(msg, keychain)
    expect(out).not.toBeNull()
    const logo = (out as Extract<Design, { kind: 'flat_plate' }>).logo
    expect(logo!.sizeRatio).toBeGreaterThan(keychain.logo!.sizeRatio)
  })

  it.each([
    'diminui mais',
    'ainda menor',
    'menor',
    'um pouco menor',
  ])('"%s" bumps logo down', (msg) => {
    const out = tryQuickModify(msg, keychain)
    expect(out).not.toBeNull()
    const logo = (out as Extract<Design, { kind: 'flat_plate' }>).logo
    expect(logo!.sizeRatio).toBeLessThan(keychain.logo!.sizeRatio)
  })
})

describe('tryQuickModify — logo treatment', () => {
  it('"vazada" switches to through_cut', () => {
    const eng = { ...keychain, logo: { ...keychain.logo!, treatment: 'engraved' as const } } as Design
    const out = tryQuickModify('faz vazada', eng)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).logo!.treatment).toBe('through_cut')
  })

  it('"em relevo" switches to embossed', () => {
    const out = tryQuickModify('em relevo', keychain)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).logo!.treatment).toBe('embossed')
  })


  it('"gravada" switches to engraved', () => {
    const out = tryQuickModify('faz gravada', keychain)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).logo!.treatment).toBe('engraved')
  })
})

describe('tryQuickModify — dimensions', () => {
  it('"mais alto" scales heightMm up', () => {
    const out = tryQuickModify('mais alto', cup)
    expect((out as Extract<Design, { kind: 'hollow_cylinder' }>).heightMm).toBeGreaterThan(cup.heightMm)
  })

  it('"mais baixo" scales heightMm down', () => {
    const out = tryQuickModify('mais baixo', cup)
    expect((out as Extract<Design, { kind: 'hollow_cylinder' }>).heightMm).toBeLessThan(cup.heightMm)
  })

  it('"mais largo" scales width on flat_plate', () => {
    const out = tryQuickModify('mais largo', keychain)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).widthMm).toBeGreaterThan(keychain.widthMm)
  })
})

describe('tryQuickModify — handle', () => {
  it('"tira a alça" removes handle', () => {
    const withHandle = Design.parse({
      ...cup,
      handle: { heightMm: 60, stickOutMm: 28, thicknessMm: 8, fingerHoleDiameterMm: 22 },
    })
    const out = tryQuickModify('tira a alça', withHandle)
    expect((out as Extract<Design, { kind: 'hollow_cylinder' }>).handle).toBeUndefined()
  })

  it('"com alça" adds handle with defaults', () => {
    const out = tryQuickModify('com alça', cup)
    expect((out as Extract<Design, { kind: 'hollow_cylinder' }>).handle).toBeDefined()
  })
})

describe('tryQuickModify — hanging hole position', () => {
  it('"buraco do lado direito" → right', () => {
    const out = tryQuickModify('põe o buraco do lado direito', keychain)
    const hole = (out as Extract<Design, { kind: 'flat_plate' }>).hangingHole!
    expect(hole.position).toBe('right')
  })

  it('"buraco do lado" → right (default)', () => {
    const out = tryQuickModify('buraco do lado', keychain)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).hangingHole!.position).toBe('right')
  })

  it('"canto superior esquerdo" → top_left', () => {
    const out = tryQuickModify('canto superior esquerdo', keychain)
    expect((out as Extract<Design, { kind: 'flat_plate' }>).hangingHole!.position).toBe('top_left')
  })
})

describe('tryQuickModify — no match', () => {
  it('returns null for unrecognized phrases', () => {
    expect(tryQuickModify('xyzzy', keychain)).toBeNull()
    expect(tryQuickModify('quero algo diferente', keychain)).toBeNull()
  })

  it('returns null when no previous design', () => {
    expect(tryQuickModify('logo maior', null)).toBeNull()
  })
})
