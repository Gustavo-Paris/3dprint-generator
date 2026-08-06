import { describe, it, expect } from 'vitest'
import { detectLsfIntent, DEFAULT_LSF_SCALE } from '@/lib/lsf/detect-intent'

describe('detectLsfIntent', () => {
  it('matches common PT-BR / EN LSF phrasings', () => {
    for (const msg of [
      'quero maquete LSF',
      'Maquete de light steel frame',
      'steel frame da casa',
      'esqueleto metálico em escala',
      'gerar maquete a partir do IFC',
      'SteelPrime Casa Real Park',
      'LSF 1:70 pro H2D',
    ]) {
      expect(detectLsfIntent(msg).matched, msg).toBe(true)
    }
  })

  it('does not match ordinary jewelry / plate prompts', () => {
    for (const msg of [
      'plaquinha 80x40 com logo',
      'chaveiro retangular',
      'porta-lata com alça',
      'disco 50mm gravado',
    ]) {
      expect(detectLsfIntent(msg).matched, msg).toBe(false)
    }
  })

  it('parses scale 1:N and escala N', () => {
    expect(detectLsfIntent('maquete LSF 1:50').scale).toBe(50)
    expect(detectLsfIntent('quero lsf escala 100').scale).toBe(100)
    expect(detectLsfIntent('quero maquete LSF').scale).toBeUndefined()
  })

  it('parses fit-bed hints', () => {
    expect(detectLsfIntent('lsf fit bed').fitBed).toBe(true)
    expect(detectLsfIntent('maquete lsf sem fit').fitBed).toBe(false)
  })

  it('ignores absurd scales', () => {
    expect(detectLsfIntent('lsf 1:9').scale).toBeUndefined()
    expect(detectLsfIntent('lsf 1:999').scale).toBeUndefined()
  })

  it('exports a sensible default scale', () => {
    expect(DEFAULT_LSF_SCALE).toBe(70)
  })
})
