import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  projectFrontToUv,
  kMeans2,
  assignExtruders,
  assignClusterToExtruder,
  sampleRgb,
  smoothExtruderLabels,
  despeckleB,
  findSubjectBounds,
  goldScore,
  redScore,
  applyPaintFromImageDetailed,
  type Rgb,
} from '@/lib/import/ops/paint-from-image'
import type { BaseMesh } from '@/lib/import/types'

function makeSlabMesh(): BaseMesh {
  const positions = new Float32Array([
    -10, 0, 0, 0, 0, 0, -10, 0, 10,
    0, 0, 0, 10, 0, 0, 0, 0, 10,
  ])
  const normals = new Float32Array([0, -1, 0, 0, -1, 0])
  return {
    positions,
    normals,
    extruders: ['A', 'A'],
    triangleCount: 2,
    bbox: {
      min: [-10, 0, 0],
      max: [10, 0, 10],
      size: [20, 0, 10],
      center: [0, 0, 5],
    },
  }
}

describe('paint_from_image helpers', () => {
  it('projects front UV with high Z at top of image', () => {
    const bbox = {
      min: [0, 0, 0] as [number, number, number],
      max: [100, 0, 50] as [number, number, number],
      size: [100, 0, 50] as [number, number, number],
      center: [50, 0, 25] as [number, number, number],
    }
    const top = projectFrontToUv(50, 50, bbox)
    const bot = projectFrontToUv(50, 0, bbox)
    expect(top.v).toBeLessThan(bot.v)
    expect(top.u).toBeCloseTo(0.5, 5)
  })

  it('maps red cluster → A and gold → B', () => {
    const red = { r: 190, g: 30, b: 30 }
    const gold = { r: 210, g: 170, b: 45 }
    expect(redScore(red)).toBeGreaterThan(redScore(gold))
    expect(goldScore(gold)).toBeGreaterThan(goldScore(red))
    const [aIdx, bIdx] = assignClusterToExtruder([red, gold])
    expect(aIdx).toBe(0)
    expect(bIdx).toBe(1)
  })

  it('k-means + assign separates red body vs gold accent', () => {
    const colors: Rgb[] = [
      { r: 180, g: 20, b: 20 },
      { r: 200, g: 30, b: 30 },
      { r: 220, g: 180, b: 40 },
      { r: 210, g: 170, b: 50 },
    ]
    const centroids = kMeans2(colors)
    const labels = assignExtruders(colors, centroids)
    expect(labels[0]).toBe(labels[1])
    expect(labels[2]).toBe(labels[3])
    expect(labels[0]).not.toBe(labels[2])
  })

  it('voxel smooth + despeckle removes isolated B cells', () => {
    // Many A tris in one voxel, single B far away in its own voxel
    const n = 20
    const positions = new Float32Array(n * 9)
    const labels: Array<'A' | 'B'> = new Array(n)
    for (let i = 0; i < n; i++) {
      const o = i * 9
      const x = i < n - 1 ? (i % 4) * 0.5 : 100 // last tri isolated
      const y = i < n - 1 ? Math.floor(i / 4) * 0.5 : 100
      positions[o] = x
      positions[o + 3] = x + 0.2
      positions[o + 6] = x
      positions[o + 1] = y
      positions[o + 4] = y
      positions[o + 7] = y + 0.2
      positions[o + 2] = 0
      positions[o + 5] = 0
      positions[o + 8] = 0.2
      labels[i] = i < n - 1 ? 'A' : 'B'
    }
    const smoothed = smoothExtruderLabels(labels, positions, 3, 2)
    const despeckled = despeckleB(smoothed, positions, 3, 4)
    expect(despeckled[n - 1]).toBe('A')
  })

  it('findSubjectBounds ignores black background', async () => {
    // 64x64 black with white square in center
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 40, b: 40 } },
          })
            .png()
            .toBuffer(),
          left: 22,
          top: 22,
        },
      ])
      .png()
      .toBuffer()
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const b = findSubjectBounds(data, info.width, info.height, info.channels)
    expect(b.u0).toBeGreaterThan(0.1)
    expect(b.u1).toBeLessThan(0.9)
    expect(b.v0).toBeGreaterThan(0.1)
    expect(b.v1).toBeLessThan(0.9)
  })

  it('applyPaintFromImageDetailed returns palette + both extruders', async () => {
    const mesh = makeSlabMesh()
    const png = await sharp({
      create: { width: 64, height: 32, channels: 3, background: { r: 190, g: 25, b: 25 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 32, height: 32, channels: 3, background: { r: 220, g: 175, b: 45 } },
          })
            .png()
            .toBuffer(),
          left: 32,
          top: 0,
        },
      ])
      .png()
      .toBuffer()

    const { mesh: painted, palette } = await applyPaintFromImageDetailed(
      mesh,
      { op: 'paint_from_image', view: 'front' },
      [],
      png,
    )
    const set = new Set(painted.extruders)
    expect(set.has('A')).toBe(true)
    expect(set.has('B')).toBe(true)
    expect(palette.A).toMatch(/^#[0-9a-f]{6}$/i)
    expect(palette.B).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('throws without image', async () => {
    await expect(
      applyPaintFromImageDetailed(makeSlabMesh(), { op: 'paint_from_image', view: 'front' }, [], null),
    ).rejects.toThrow(/reference image/)
  })
})
