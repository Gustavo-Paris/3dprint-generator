import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { alignMeshes } from '@/lib/flexify/align'
import { decompose } from '@/lib/flexify/decompose'
import { chunkMeshByComponents } from '@/lib/flexify/chunk'

let meshyMesh: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let rocktopusMesh: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const meshyBytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/meshy-mascot.3mf')),
  )
  const rockBytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/rocktopus-reference.3mf')),
  )
  meshyMesh = await loadBaseMeshFromBytes(meshyBytes)
  rocktopusMesh = await loadBaseMeshFromBytes(rockBytes)
})

describe('flexify/chunk', () => {
  it('produces one chunk per component', () => {
    const { meshy, rocktopus } = alignMeshes(meshyMesh, rocktopusMesh)
    const comps = decompose(rocktopus)
    const chunks = chunkMeshByComponents(meshy, comps)
    expect(chunks.length).toBe(comps.length)
    expect(chunks.length).toBe(41)
  })

  it('body chunk (componentId 0) is the largest', () => {
    const { meshy, rocktopus } = alignMeshes(meshyMesh, rocktopusMesh)
    const comps = decompose(rocktopus)
    const chunks = chunkMeshByComponents(meshy, comps)
    const sorted = [...chunks].sort((a, b) => b.triangleCount - a.triangleCount)
    expect(sorted[0].componentId).toBe(0)
  })

  it('every Meshy triangle is claimed by exactly one chunk (no drops)', () => {
    const { meshy, rocktopus } = alignMeshes(meshyMesh, rocktopusMesh)
    const comps = decompose(rocktopus)
    const chunks = chunkMeshByComponents(meshy, comps)
    const total = chunks.reduce((s, c) => s + c.triangleCount, 0)
    expect(total).toBe(meshy.triangleCount)
  })

  it('at most a handful of outer-tip components end up empty (topology mismatch)', () => {
    // Some Rocktopus tentacle tips, after scaling, land outside the Meshy's
    // extent. Those chunks come out empty — F5 will fall back to using the
    // Rocktopus component geometry for those.
    const { meshy, rocktopus } = alignMeshes(meshyMesh, rocktopusMesh)
    const comps = decompose(rocktopus)
    const chunks = chunkMeshByComponents(meshy, comps)
    const empty = chunks.filter((c) => c.triangleCount === 0)
    expect(empty.length).toBeLessThanOrEqual(8)  // up to 1 per tentacle is acceptable
  })
})
