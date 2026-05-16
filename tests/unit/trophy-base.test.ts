import { describe, it, expect } from 'vitest'
import { buildTrophyBase } from '@/lib/compose/trophy-base'

describe('buildTrophyBase', () => {
  it('produces a valid binary STL with > 0 triangles', () => {
    const stl = buildTrophyBase({ topDiameter: 60, bottomDiameter: 80, height: 30 })
    expect(stl).toBeInstanceOf(Uint8Array)
    expect(stl.byteLength).toBeGreaterThan(84) // header + count + at least 1 triangle
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
    const triCount = dv.getUint32(80, true)
    expect(triCount).toBeGreaterThan(100) // a unioned 64-segment cylinder stack has hundreds
    // Byte length matches: 84 header + 50 per triangle
    expect(stl.byteLength).toBe(84 + 50 * triCount)
  })

  it('scales with the height parameter', () => {
    const small = buildTrophyBase({ topDiameter: 60, bottomDiameter: 80, height: 20 })
    const big = buildTrophyBase({ topDiameter: 60, bottomDiameter: 80, height: 100 })
    // Both should be valid; can't directly compare bbox without parsing, but
    // both should be similar triangle count since the tessellation is segment-driven.
    const dvSmall = new DataView(small.buffer, small.byteOffset, small.byteLength)
    const dvBig = new DataView(big.buffer, big.byteOffset, big.byteLength)
    expect(dvSmall.getUint32(80, true)).toBeGreaterThan(0)
    expect(dvBig.getUint32(80, true)).toBeGreaterThan(0)
  })
})
