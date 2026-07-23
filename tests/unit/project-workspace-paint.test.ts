import { describe, it, expect } from 'vitest'
import { hasPaintableMesh, hasImportedBase, float32ToBase64 } from '@/components/ProjectWorkspace'

const it_ = (over: Record<string, unknown>) =>
  ({ validationReport: null, ...over }) as never

describe('hasPaintableMesh', () => {
  it('true when a fresh .3mf is pending', () => {
    expect(hasPaintableMesh([], 'blob://mesh.3mf')).toBe(true)
  })

  it('true for imported history (same as logo gate)', () => {
    const history = [it_({ validationReport: { kind: 'imported', baseMeshUrl: '/x.3mf' } })]
    expect(hasPaintableMesh(history, null)).toBe(true)
  })

  it('true for freeform meshes — paint is client-side, works on any mesh', () => {
    const history = [it_({ validationReport: { kind: 'freeform', prompt: 'a dragon' } })]
    expect(hasPaintableMesh(history, null)).toBe(true)
    // …while the logo gate stays imported-only.
    expect(hasImportedBase(history, null)).toBe(false)
  })

  it('true for flexified meshes', () => {
    const history = [it_({ validationReport: { kind: 'flexified' } })]
    expect(hasPaintableMesh(history, null)).toBe(true)
  })

  it('false for purely parametric projects', () => {
    const history = [it_({ validationReport: { kind: 'flat_plate', widthMm: 80 } })]
    expect(hasPaintableMesh(history, null)).toBe(false)
    expect(hasPaintableMesh([it_({ validationReport: null })], null)).toBe(false)
  })
})

describe('float32ToBase64', () => {
  it('round-trips through Buffer decode (server-side decodePositions contract)', () => {
    // One triangle = 9 floats = 36 bytes (whole-triangle rule on the server).
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const b64 = float32ToBase64(positions)
    // Strict base64 alphabet — the paint-save zod schema regexes this.
    expect(b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    const buf = Buffer.from(b64, 'base64')
    expect(buf.byteLength).toBe(36)
    expect(buf.byteLength % 36).toBe(0)
    const decoded = new Float32Array(new Uint8Array(buf).buffer)
    expect(Array.from(decoded)).toEqual(Array.from(positions))
  })

  it('handles arrays larger than one chunk (32k bytes) without arg-limit blowups', () => {
    // 4000 triangles = 36k floats = 144KB > the 32KB chunk size.
    const n = 4000 * 9
    const positions = new Float32Array(n)
    for (let i = 0; i < n; i++) positions[i] = i % 251
    const b64 = float32ToBase64(positions)
    const decoded = new Float32Array(new Uint8Array(Buffer.from(b64, 'base64')).buffer)
    expect(decoded.length).toBe(n)
    expect(decoded[0]).toBe(0)
    expect(decoded[n - 1]).toBe((n - 1) % 251)
  })

  it('respects a subarray view (byteOffset ≠ 0)', () => {
    const backing = new Float32Array([9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const view = backing.subarray(3) // skip the first 3 floats
    const decoded = new Float32Array(new Uint8Array(Buffer.from(float32ToBase64(view), 'base64')).buffer)
    expect(Array.from(decoded)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
