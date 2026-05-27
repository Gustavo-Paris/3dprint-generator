// tests/unit/import/apply-edits.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyEdits } from '@/lib/import/apply-edits'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyEdits', () => {
  it('runs scale then verifies new bbox', async () => {
    const { mesh, warnings } = await applyEdits(cube, [{ op: 'scale', factor: 0.5 }], faces)
    expect(warnings).toEqual([])
    expect(mesh.bbox.size[0]).toBeCloseTo(15, 1)
  })

  it('collects warning for failing op, continues with next', async () => {
    const { mesh, warnings } = await applyEdits(cube, [
      { op: 'hole', faceId: 99, shape: 'circle', diameterMm: 5, depthMm: 'through', positions: [[0, 0]] },
      { op: 'scale', factor: 2 },
    ], faces)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].op).toBe('hole')
    expect(mesh.bbox.size[0]).toBeCloseTo(60, 1)  // scale still ran
  })

  it('empty edits returns the input mesh unchanged', async () => {
    const { mesh, warnings } = await applyEdits(cube, [], faces)
    expect(warnings).toEqual([])
    expect(mesh).toBe(cube)
  })
})
