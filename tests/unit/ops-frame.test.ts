import { describe, it, expect } from 'vitest'
import { makeFrame, orientAlongNormal } from '@/lib/import/ops/_shared'
import * as jscad from '@jscad/modeling'

const transforms = (jscad as { default?: typeof jscad }).default?.transforms ?? jscad.transforms

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

describe('orientAlongNormal', () => {
  it('is identity when the normal already points +Z', () => {
    const prim = (jscad as { default?: typeof jscad }).default?.primitives ?? jscad.primitives
    const geom = prim.cuboid({ size: [2, 2, 2] })
    const out = orientAlongNormal(geom as never, [0, 0, 1], transforms)
    expect(out).toBe(geom) // dot > 0.9999 short-circuit returns the input
  })
})
