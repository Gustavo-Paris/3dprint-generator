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
  it('embossed carves the host then appends logo B (no double walls)', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'embossed', offsetMm: [0, 0],
    }, faces)
    // Distinct extruder-B body for multi-colour; host A was carved so the
    // logo does not stack on top of existing geometry (double-wall bug).
    const extruders = new Set(out.extruders)
    expect(extruders.has('A')).toBe(true)
    expect(extruders.has('B')).toBe(true)
    const aTris = out.extruders.filter((e) => e === 'A').length
    // Carve must change A (cube alone is not still the full A soup).
    expect(aTris).not.toBe(cube.triangleCount)
    // Proud of the cube by ~half depth after embed.
    expect(out.bbox.size[2]).toBeGreaterThan(30.2)
    expect(out.bbox.size[2]).toBeLessThan(30.8)
  })

  it('engraved carves the host and fills the recess with a colour-B inlay', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'engraved', offsetMm: [0, 0],
    }, faces)
    // Inlay = host carved (A) + (logo ∩ mesh) as B — intersect so the fill
    // never floats outside a curved host.
    const extruders = new Set(out.extruders)
    expect(extruders.has('A')).toBe(true)
    expect(extruders.has('B')).toBe(true)
    // It sits flush in the surface — not raised like an emboss: Z stays ~30mm.
    expect(out.bbox.size[2]).toBeGreaterThan(29.5)
    expect(out.bbox.size[2]).toBeLessThan(30.3)
  })

  it('anchorPoint placement still produces a multi-extruder result', async () => {
    // Click-to-place path (no faceId) — same clipping as face-based.
    const out = await applyAddLogo(cube, {
      op: 'add_logo',
      imageUrl: 'http://mock/logo.png',
      sizeMm: 8,
      depthMm: 0.8,
      treatment: 'engraved',
      offsetMm: [0, 0],
      anchorPoint: [0, 0, 15],
      anchorNormal: [0, 0, 1],
    }, faces)
    expect(new Set(out.extruders).has('B')).toBe(true)
    expect(out.bbox.size[2]).toBeLessThan(30.3)
  })
})
