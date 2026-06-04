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
  it('embossed appends a separate extruder-B body protruding above the face', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'embossed', offsetMm: [0, 0],
    }, faces)
    // The logo is a distinct extruder-B body (two-colour print), not unioned.
    const extruders = new Set(out.extruders)
    expect(extruders.has('A')).toBe(true)
    expect(extruders.has('B')).toBe(true)
    // It protrudes above the 30mm cube, but sits slightly embedded (< full
    // depth) so the slicer fuses it: 30 < z < 30.6.
    expect(out.bbox.size[2]).toBeGreaterThan(30.3)
    expect(out.bbox.size[2]).toBeLessThan(30.6)
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
