// tests/unit/import/ops-add-logo.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyAddLogo } from '@/lib/import/ops/add-logo'

// Mock fetch for image URL — return a small PNG.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => {
    // Tiny 4x4 black PNG
    const png = await readFile(join(__dirname, '../../fixtures/black-4x4.png'))
    return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
  },
})))

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyAddLogo', () => {
  it('embossed adds geometry above the chosen face', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'embossed', offsetMm: [0, 0],
    }, faces)
    // Z bbox should be roughly 30 + 0.6 = 30.6 for embossed
    expect(out.bbox.size[2]).toBeGreaterThan(30.4)
  })

  it('engraved reduces or keeps bbox', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'engraved', offsetMm: [0, 0],
    }, faces)
    expect(out.bbox.size[2]).toBeLessThanOrEqual(30.01)
  })
})
