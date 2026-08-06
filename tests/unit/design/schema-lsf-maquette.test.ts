import { describe, it, expect } from 'vitest'
import { Design } from '@/lib/design/schema'

describe('Design.lsf_maquette variant', () => {
  it('parses minimal IFC maquete design with defaults', () => {
    const result = Design.safeParse({
      kind: 'lsf_maquette',
      ifcUrl: '/uploads/house.ifc',
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.kind === 'lsf_maquette') {
      expect(result.data.scale).toBe(70)
      expect(result.data.minTMm).toBe(1.9)
      expect(result.data.fitBed).toBe(true)
    }
  })

  it('rejects empty ifcUrl', () => {
    const result = Design.safeParse({
      kind: 'lsf_maquette',
      ifcUrl: '',
    })
    expect(result.success).toBe(false)
  })
})
