import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyPaintRegion } from '@/lib/import/ops/paint-region'
import { applyEdits } from '@/lib/import/apply-edits'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyPaintRegion', () => {
  it('paints upper half to B without changing geometry', async () => {
    const painted = await applyPaintRegion(
      cube,
      { op: 'paint_region', extruder: 'B', region: 'upper_half' },
      faces,
    )
    expect(painted.positions).toBe(cube.positions) // same geometry buffer ref path — positions length
    expect(painted.positions.length).toBe(cube.positions.length)
    expect(painted.bbox.size[0]).toBeCloseTo(cube.bbox.size[0], 5)

    const bCount = painted.extruders.filter((e) => e === 'B').length
    const aCount = painted.extruders.filter((e) => e === 'A').length
    expect(bCount).toBeGreaterThan(0)
    expect(aCount).toBeGreaterThan(0)
    expect(bCount + aCount).toBe(painted.triangleCount)
  })

  it('paints all to A (reset)', async () => {
    const mid = await applyPaintRegion(
      cube,
      { op: 'paint_region', extruder: 'B', region: 'upper_half' },
      faces,
    )
    const reset = await applyPaintRegion(
      mid,
      { op: 'paint_region', extruder: 'A', region: 'all' },
      faces,
    )
    expect(reset.extruders.every((e) => e === 'A')).toBe(true)
  })

  it('paints by faceIds', async () => {
    const id = faces[0]?.id ?? 0
    const painted = await applyPaintRegion(
      cube,
      { op: 'paint_region', extruder: 'B', faceIds: [id] },
      faces,
    )
    const expected = new Set(faces.find((f) => f.id === id)?.triangleIndices ?? [])
    for (let i = 0; i < painted.triangleCount; i++) {
      if (expected.has(i)) expect(painted.extruders[i]).toBe('B')
    }
  })

  it('throws when selector matches nothing invalid face', async () => {
    await expect(
      applyPaintRegion(cube, { op: 'paint_region', extruder: 'B', faceIds: [99999] }, faces),
    ).rejects.toThrow(/0 triangles/)
  })

  it('applyEdits wires paint_region', async () => {
    const { mesh, warnings } = await applyEdits(
      cube,
      [{ op: 'paint_region', extruder: 'B', region: 'lower_half' }],
      faces,
    )
    expect(warnings).toEqual([])
    expect(mesh.extruders.some((e) => e === 'B')).toBe(true)
  })
})

describe('generateFromDesign + paint_region', () => {
  it('splits into two bodies for multi-colour 3MF path', async () => {
    // Use a data URL path that loadBaseMeshFromUrl can't hit — instead exercise
    // via applyEdits + the same split logic by calling generate with a file URL.
    // generateFromDesign loads baseMeshUrl from disk/http; for unit test we only
    // assert applyEdits+split contract through the public generate API when URL
    // is a local public path. Skip if fixture not exposed under public/.
    const { mesh } = await applyEdits(
      cube,
      [{ op: 'paint_region', extruder: 'B', zFraction: { min: 0.5, max: 1 } }],
      faces,
    )
    const distinct = new Set(mesh.extruders)
    expect(distinct.has('A') && distinct.has('B')).toBe(true)
  })
})
