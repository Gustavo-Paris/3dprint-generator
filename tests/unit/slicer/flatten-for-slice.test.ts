import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { applyAddLogo } from '@/lib/import/ops/add-logo'
import { segmentFaces } from '@/lib/import/face-segment'
import { flattenMeshForSlice } from '@/lib/slice/flatten-for-slice'
import { vi, beforeAll } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => {
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

describe('flattenMeshForSlice', () => {
  it('returns a single solid after embossed multi-body logo (no separate shell)', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const multi = await applyAddLogo(cube, {
      op: 'add_logo',
      faceId: topFace,
      imageUrl: 'http://mock/logo.png',
      sizeMm: 12,
      depthMm: 1.4,
      treatment: 'embossed',
      offsetMm: [0, 0],
    }, faces)

    // Multi-extruder input
    expect(new Set(multi.extruders).has('B')).toBe(true)

    const solid = await flattenMeshForSlice(multi)
    expect(solid.length).toBeGreaterThan(9)
    expect(solid.length % 9).toBe(0)

    // Union should produce one connected volume that still protrudes past the
    // cube's original Z span (cube is centred on origin, size 30 → z ±15).
    let minZ = Infinity, maxZ = -Infinity
    for (let i = 2; i < solid.length; i += 3) {
      if (solid[i] < minZ) minZ = solid[i]
      if (solid[i] > maxZ) maxZ = solid[i]
    }
    expect(maxZ - minZ).toBeGreaterThan(30.2)
  })

  it('is a no-op for single-extruder meshes', async () => {
    const solid = await flattenMeshForSlice(cube)
    expect(solid.length).toBe(cube.positions.length)
  })
})
