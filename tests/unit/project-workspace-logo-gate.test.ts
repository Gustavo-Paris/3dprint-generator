import { describe, it, expect } from 'vitest'
import { hasImportedBase } from '@/components/ProjectWorkspace'

const it_ = (over: Record<string, unknown>) =>
  ({ validationReport: null, ...over }) as never

describe('hasImportedBase', () => {
  it('true when a fresh .3mf is pending', () => {
    expect(hasImportedBase([], 'blob://mesh.3mf')).toBe(true)
  })
  it('true when history has an imported design', () => {
    const history = [it_({ validationReport: { kind: 'imported', baseMeshUrl: '/x.3mf' } })]
    expect(hasImportedBase(history, null)).toBe(true)
  })
  it('false for a purely parametric project', () => {
    const history = [it_({ validationReport: { kind: 'flat_plate', widthMm: 80 } })]
    expect(hasImportedBase(history, null)).toBe(false)
  })
})
