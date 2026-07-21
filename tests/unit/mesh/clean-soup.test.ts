import { describe, it, expect } from 'vitest'
import { cleanTriangleSoup } from '@/lib/mesh/clean-soup'

describe('cleanTriangleSoup', () => {
  it('keeps normal-sized triangles', () => {
    // 10×10 right triangle, area 50
    const soup = new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 10, 0,
    ])
    const out = cleanTriangleSoup(soup)
    expect(out.length).toBe(9)
  })

  it('drops only near-zero sliver triangles by default', () => {
    // 0.005 mm edges — numerical garbage, not design detail
    const soup = new Float32Array([
      0, 0, 0, 0.005, 0, 0, 0, 0.005, 0,
      0, 0, 0, 10, 0, 0, 0, 10, 0, // keep
    ])
    const out = cleanTriangleSoup(soup)
    expect(out.length).toBe(9)
    expect(out[3]).toBe(10)
  })

  it('can drop sub-nozzle tris when caller asks for aggressive filter', () => {
    const soup = new Float32Array([
      0, 0, 0, 0.05, 0, 0, 0, 0.05, 0,
      0, 0, 0, 10, 0, 0, 0, 10, 0,
    ])
    const out = cleanTriangleSoup(soup, { minEdgeMm: 0.12, minAreaMm2: 0.004 })
    expect(out.length).toBe(9)
    expect(out[3]).toBe(10)
  })
})
