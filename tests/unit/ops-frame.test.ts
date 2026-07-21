import { describe, it, expect } from 'vitest'
import { makeFrame, mat4AlignZToNormal, orientAlongNormal } from '@/lib/import/ops/_shared'
import * as jscad from '@jscad/modeling'

const j = (jscad as { default?: typeof jscad }).default ?? jscad
const transforms = j.transforms
const measurements = j.measurements
const primitives = j.primitives

describe('makeFrame', () => {
  it('returns a tangent + bitangent orthogonal to the normal and to each other', () => {
    const n: [number, number, number] = [0, 0, 1]
    const { tangent, bitangent } = makeFrame(n)
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(Math.abs(dot(tangent, n))).toBeLessThan(1e-9)
    expect(Math.abs(dot(bitangent, n))).toBeLessThan(1e-9)
    expect(Math.abs(dot(tangent, bitangent))).toBeLessThan(1e-9)
  })
})

describe('mat4AlignZToNormal', () => {
  function applyColMajor(mat: number[], v: [number, number, number]) {
    const [x, y, z] = v
    return [
      mat[0] * x + mat[4] * y + mat[8] * z,
      mat[1] * x + mat[5] * y + mat[9] * z,
      mat[2] * x + mat[6] * y + mat[10] * z,
    ]
  }

  it('maps +Z onto a diagonal normal (the old rotateX/Y shortcut failed here)', () => {
    const n: [number, number, number] = [0.5, 0.5, 0.70710678118]
    const out = applyColMajor(mat4AlignZToNormal(n), [0, 0, 1])
    expect(out[0]).toBeCloseTo(n[0], 5)
    expect(out[1]).toBeCloseTo(n[1], 5)
    expect(out[2]).toBeCloseTo(n[2], 5)
  })
})

describe('orientAlongNormal', () => {
  it('is identity when the normal already points +Z', () => {
    const geom = primitives.cuboid({ size: [2, 2, 2] })
    const out = orientAlongNormal(geom as never, [0, 0, 1], transforms)
    expect(out).toBe(geom) // dot > 0.9999 short-circuit returns the input
  })

  it('aligns a Z-long cuboid so its longest extent follows a diagonal normal', () => {
    // 4mm along Z; after orient, the diagonal direction should carry ~4mm span.
    const geom = primitives.cuboid({ size: [1, 1, 4] })
    const n: [number, number, number] = [0.5, 0.5, 0.70710678118]
    const out = orientAlongNormal(geom as never, n, transforms)
    const [[minX, minY, minZ], [maxX, maxY, maxZ]] = measurements.measureBoundingBox(out)
    const size = [maxX - minX, maxY - minY, maxZ - minZ]
    // Broken shortcut produced [3.54, 1, 3.54] (Y stuck at 1). Proper maps all axes.
    expect(size[1]).toBeGreaterThan(2.5)
    expect(Math.max(...size)).toBeGreaterThan(3.5)
  })
})
