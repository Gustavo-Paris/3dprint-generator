import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'

const W = 240
const H = 240

/**
 * Build a flat (no-alpha) PNG: an 80×80 ink square centred on a background
 * that is optionally a grey/white "transparency grid" checkerboard — the
 * exact shape of a logo exported with the editor's transparency grid
 * flattened into opaque pixels.
 */
async function makeImage(ink: [number, number, number], checkerboard: boolean) {
  const buf = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      let r = 255, g = 255, b = 255
      if (checkerboard && (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0) {
        r = g = b = 200
      }
      if (x >= 80 && x < 160 && y >= 80 && y < 160) {
        ;[r, g, b] = ink
      }
      buf[i] = r
      buf[i + 1] = g
      buf[i + 2] = b
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
}

describe('extrudeLogo — colour vs luminance mask path', () => {
  it('ignores a baked-in transparency checkerboard around a coloured logo', async () => {
    // Blue ink on a grey/white checkerboard. The checkerboard is achromatic
    // (saturation ≈ 0); the saturation mask drops it entirely. If it were
    // traced via luminance, the outer count would be in the hundreds.
    const imageBuffer = await makeImage([32, 48, 224], true)
    const { meta } = await extrudeLogo({ imageBuffer, targetMaxDim: 60, depthMm: 4 })
    expect(meta.outers).toBeGreaterThanOrEqual(1)
    expect(meta.outers).toBeLessThanOrEqual(3)
  })

  it('still traces a monochrome logo via the luminance path', async () => {
    // Black ink, no colour signal → luminance path, unchanged behaviour.
    const imageBuffer = await makeImage([0, 0, 0], false)
    const { meta } = await extrudeLogo({ imageBuffer, targetMaxDim: 60, depthMm: 4 })
    expect(meta.outers).toBeGreaterThanOrEqual(1)
    expect(meta.outers).toBeLessThanOrEqual(3)
  })
})
