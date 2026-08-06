import { describe, it, expect } from 'vitest'
import { assertSliceable, allowsNonWatertightSlice } from '@/lib/slice/preconditions'

describe('assertSliceable', () => {
  it('allows ready and sliced', () => {
    expect(assertSliceable('ready').ok).toBe(true)
    expect(assertSliceable('sliced').ok).toBe(true)
  })
  it('rejects generating and failed with a 409', () => {
    const g = assertSliceable('generating')
    expect(g.ok).toBe(false)
    expect(g.ok ? null : g.status).toBe(409)
    expect(assertSliceable('failed').ok).toBe(false)
  })
})

describe('allowsNonWatertightSlice', () => {
  it('allows LSF maquete multi-body skeletons', () => {
    expect(allowsNonWatertightSlice('lsf_maquette')).toBe(true)
  })
  it('does not open the gate for ordinary strategies', () => {
    expect(allowsNonWatertightSlice('imported')).toBe(false)
    expect(allowsNonWatertightSlice('flat_plate')).toBe(false)
    expect(allowsNonWatertightSlice(null)).toBe(false)
  })
})
