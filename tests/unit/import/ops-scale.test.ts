import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { applyScale } from '@/lib/import/ops/scale'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
})

describe('applyScale', () => {
  it('uniform scale 2x doubles bbox', async () => {
    const out = await applyScale(cube, { op: 'scale', factor: 2 })
    expect(out.bbox.size[0]).toBeCloseTo(60, 1)
    expect(out.bbox.size[1]).toBeCloseTo(60, 1)
    expect(out.bbox.size[2]).toBeCloseTo(60, 1)
  })

  it('per-axis scale stretches Z only', async () => {
    const out = await applyScale(cube, { op: 'scale', factor: { x: 1, y: 1, z: 3 } })
    expect(out.bbox.size[0]).toBeCloseTo(30, 1)
    expect(out.bbox.size[2]).toBeCloseTo(90, 1)
  })

  it('preserves triangle count and extruders', async () => {
    const out = await applyScale(cube, { op: 'scale', factor: 0.5 })
    expect(out.triangleCount).toBe(cube.triangleCount)
    expect(out.extruders).toEqual(cube.extruders)
  })
})
