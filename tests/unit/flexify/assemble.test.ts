import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { alignMeshes } from '@/lib/flexify/align'
import { decompose, buildConnectionGraph } from '@/lib/flexify/decompose'
import { chunkMeshByComponents } from '@/lib/flexify/chunk'
import { buildJointDonations } from '@/lib/flexify/joints'
import { assembleBodies } from '@/lib/flexify/assemble'

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

describe('flexify/assemble', () => {
  function runFullPipeline() {
    const { meshy, rocktopus } = alignMeshes(meshyMesh, rocktopusMesh)
    const components = decompose(rocktopus)
    const connections = buildConnectionGraph(rocktopus, components)
    const chunks = chunkMeshByComponents(meshy, components)
    const donations = buildJointDonations(rocktopus, components, connections)
    const bodies = assembleBodies(rocktopus, components, connections, chunks, donations)
    return { rocktopus, components, connections, chunks, donations, bodies }
  }

  it('produces one body per component', () => {
    const { components, bodies } = runFullPipeline()
    expect(bodies.length).toBe(components.length)
  })

  it('every body has at least 1 triangle (fallback ensures non-empty)', () => {
    const { bodies } = runFullPipeline()
    const emptyBodies = bodies.filter((b) => b.triangleCount === 0)
    expect(emptyBodies).toEqual([])
  })

  it('body component is dominated by Meshy chunk (no fallback expected)', () => {
    const { bodies } = runFullPipeline()
    expect(bodies[0].fallbackUsed).toBe(false)
    expect(bodies[0].triangleCount).toBeGreaterThan(10_000)
  })

  it('triangle counts add up to Meshy + Rocktopus (simplified: no exclusions, whole Rocktopus per body)', () => {
    const { bodies } = runFullPipeline()
    const total = bodies.reduce((s, b) => s + b.triangleCount, 0)
    // Each body = whole Rocktopus component + Meshy chunk.
    // Sum across bodies = full Rocktopus triangle count + full Meshy triangle count.
    expect(total).toBe(meshyMesh.triangleCount + rocktopusMesh.triangleCount)
  })

  it('per-triangle extruder array length matches triangle count exactly', () => {
    const { bodies } = runFullPipeline()
    for (const b of bodies) {
      expect(b.extruders.length).toBe(b.triangleCount)
    }
  })
})
