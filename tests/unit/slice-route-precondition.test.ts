import { describe, it, expect } from 'vitest'
import { assertSliceable } from '@/lib/slice/preconditions'

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
