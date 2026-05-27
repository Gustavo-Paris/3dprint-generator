import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyEmbossText } from '@/lib/import/ops/emboss-text'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyEmbossText', () => {
  it('embossed text grows Z bbox', async () => {
    const top = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyEmbossText(cube, {
      op: 'emboss_text', faceId: top, text: 'HI',
      treatment: 'embossed', sizeMm: 6, depthMm: 0.5, offsetMm: [0, 0],
    }, faces)
    expect(out.bbox.size[2]).toBeGreaterThan(30.3)
  })
})
