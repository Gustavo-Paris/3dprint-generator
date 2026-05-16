import { describe, it, expect } from 'vitest'
import { parseBinarySTL } from '@/lib/jscad/runner'

describe('parseBinarySTL', () => {
  it('extracts triangle positions from binary STL', () => {
    const buf = new ArrayBuffer(84 + 50)
    const dv = new DataView(buf)
    dv.setUint32(80, 1, true)
    const base = 84
    // 3 vertices (skip normal at base..base+11): (0,0,0) (1,0,0) (0,1,0)
    dv.setFloat32(base + 12, 0, true); dv.setFloat32(base + 16, 0, true); dv.setFloat32(base + 20, 0, true)
    dv.setFloat32(base + 24, 1, true); dv.setFloat32(base + 28, 0, true); dv.setFloat32(base + 32, 0, true)
    dv.setFloat32(base + 36, 0, true); dv.setFloat32(base + 40, 1, true); dv.setFloat32(base + 44, 0, true)
    const stl = new Uint8Array(buf)

    const positions = parseBinarySTL(stl)
    expect(positions.length).toBe(9)
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })

  it('handles multi-triangle STL', () => {
    const triCount = 12 // cube
    const buf = new ArrayBuffer(84 + 50 * triCount)
    const dv = new DataView(buf)
    dv.setUint32(80, triCount, true)
    // we don't bother writing real vertices — they'll be zeros except for the count
    const positions = parseBinarySTL(new Uint8Array(buf))
    expect(positions.length).toBe(triCount * 9)
  })
})
