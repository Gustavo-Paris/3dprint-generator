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

describe('upright orientation on side faces (prod regression 2026-08-02)', () => {
  it('keeps a tall glyph vertical when placed on a +X side face', async () => {
    // Tall bar PNG (1:3 aspect): after placement its long axis must follow
    // world +Z (text upright), not lie sideways along +Y — the minimal
    // +Z→normal rotation left the roll arbitrary on side faces.
    const sharp = (await import('sharp')).default
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="180">' +
      '<rect width="60" height="180" fill="white"/>' +
      '<rect x="15" y="10" width="30" height="160" fill="black"/></svg>'
    const png = await sharp(Buffer.from(svg)).png().toBuffer()

    const cubeFaces = segmentFaces(cube)
    const sideFace = cubeFaces.findIndex((f) => Math.abs(f.normal[0] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: sideFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 15, depthMm: 0.6, treatment: 'embossed', offsetMm: [0, 0],
    } as never, cubeFaces, png)

    // Measure the B (logo) body extents
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    out.extruders.forEach((e, t) => {
      if (e !== 'B') return
      for (let k = 0; k < 9; k += 3) {
        const y = out.positions[t * 9 + k + 1]
        const z = out.positions[t * 9 + k + 2]
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
    })
    const ySpan = maxY - minY
    const zSpan = maxZ - minZ
    // 1:3 bar → upright means Z-span ~3x the Y-span
    expect(zSpan).toBeGreaterThan(ySpan * 1.8)
  })
})
