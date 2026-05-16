import { describe, it, expect } from 'vitest'
import { composeOnTop } from '@/lib/compose/stl-compose'
import { serializeBinarySTL } from '@/lib/stl/serialize'

function singleTriangleSTL(coords: number[]): Uint8Array {
  return serializeBinarySTL(coords)
}

describe('composeOnTop', () => {
  it('produces a combined STL with triangles from both meshes', () => {
    // Base: one triangle at z=0..1 (in XY plane near origin)
    const base = singleTriangleSTL([0, 0, 0, 10, 0, 0, 0, 10, 0])
    // Top: one triangle at z=0..1 (will be translated up)
    const top = singleTriangleSTL([0, 0, 0, 5, 0, 0, 0, 5, 0])

    const out = composeOnTop({ top, base, baseHeight: 10, scaleTopTo: 5, overlap: 0.5 })
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    const triCount = dv.getUint32(80, true)
    expect(triCount).toBe(2) // base + top each contribute 1
    expect(out.byteLength).toBe(84 + 50 * 2)
  })

  it('scales top piece so its max XY = scaleTopTo', () => {
    const base = singleTriangleSTL([0, 0, 0, 1, 0, 0, 0, 1, 0])
    // Top: triangle spanning 0..20 in X (and 0..10 in Y)
    const top = singleTriangleSTL([0, 0, 0, 20, 0, 0, 0, 10, 0])

    const out = composeOnTop({ top, base, baseHeight: 5, scaleTopTo: 40, overlap: 0 })
    // After scale: max XY of top should be 40. We can sanity-check by reading
    // back the top triangle vertices (they're after the base triangle).
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    // Top triangle starts at base 84 + 50 (skip base tri) + 12 (skip top normal)
    const topV0X = dv.getFloat32(84 + 50 + 12, true)
    const topV1X = dv.getFloat32(84 + 50 + 12 + 12, true) // 12 bytes per vertex (3 floats * 4 bytes)
    // After centering: top vertices range [-20..20] originally → scaled to fit 40
    // Just check that scale factor was 2 (since 40 / 20 = 2)
    const spanX = Math.abs(topV1X - topV0X)
    expect(spanX).toBeCloseTo(40, 1) // 20 * scale 2 = 40
  })

  it('places top.minZ at baseHeight - overlap', () => {
    const base = singleTriangleSTL([0, 0, 0, 1, 0, 0, 0, 1, 0])
    // Top: triangle with min.Z = 5
    const top = singleTriangleSTL([0, 0, 5, 1, 0, 5, 0, 1, 6])

    const baseHeight = 30
    const overlap = 0.5
    const out = composeOnTop({ top, base, baseHeight, scaleTopTo: 10, overlap })

    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    // Top triangle vertex Zs are at offsets 84+50+12+8, +12+8+12, +12+8+24
    const z0 = dv.getFloat32(84 + 50 + 12 + 8, true)
    const z1 = dv.getFloat32(84 + 50 + 12 + 20, true)
    const z2 = dv.getFloat32(84 + 50 + 12 + 32, true)
    const minZ = Math.min(z0, z1, z2)
    expect(minZ).toBeCloseTo(baseHeight - overlap, 1)
  })
})
