// tests/unit/import/ops-hole.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyHole } from '@/lib/import/ops/hole'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyHole', () => {
  it('through hole increases triangle count', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyHole(cube, {
      op: 'hole', faceId: topFace, shape: 'circle',
      diameterMm: 5, depthMm: 'through', positions: [[0, 0]],
    }, faces)
    expect(out.triangleCount).toBeGreaterThan(cube.triangleCount)
  })

  it('fails (warning) on faceId out of range', async () => {
    await expect(applyHole(cube, {
      op: 'hole', faceId: 99, shape: 'circle',
      diameterMm: 5, depthMm: 'through', positions: [[0, 0]],
    }, faces)).rejects.toThrow(/face/i)
  })
})
