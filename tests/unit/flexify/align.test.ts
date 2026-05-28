import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { alignMeshes, centerAtOrigin, scaleMesh } from '@/lib/flexify/align'

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

describe('flexify/align', () => {
  it('centerAtOrigin moves bbox center to 0,0,0', () => {
    const centered = centerAtOrigin(rocktopusMesh)
    expect(centered.bbox.center[0]).toBeCloseTo(0, 4)
    expect(centered.bbox.center[1]).toBeCloseTo(0, 4)
    expect(centered.bbox.center[2]).toBeCloseTo(0, 4)
    // Sizes preserved.
    expect(centered.bbox.size[0]).toBeCloseTo(rocktopusMesh.bbox.size[0], 4)
  })

  it('scaleMesh by 2 doubles bbox size', () => {
    const doubled = scaleMesh(rocktopusMesh, 2)
    expect(doubled.bbox.size[0]).toBeCloseTo(rocktopusMesh.bbox.size[0] * 2, 4)
    expect(doubled.bbox.size[1]).toBeCloseTo(rocktopusMesh.bbox.size[1] * 2, 4)
    expect(doubled.bbox.size[2]).toBeCloseTo(rocktopusMesh.bbox.size[2] * 2, 4)
  })

  it('alignMeshes centers both meshes and scales rocktopus to meshy XY', () => {
    const { meshy, rocktopus, rocktopusScale } = alignMeshes(meshyMesh, rocktopusMesh)

    // Both centered at origin
    expect(meshy.bbox.center[0]).toBeCloseTo(0, 3)
    expect(meshy.bbox.center[1]).toBeCloseTo(0, 3)
    expect(rocktopus.bbox.center[0]).toBeCloseTo(0, 3)
    expect(rocktopus.bbox.center[1]).toBeCloseTo(0, 3)

    // Rocktopus's larger XY matches Meshy's larger XY (within 1mm tolerance)
    const meshyXY = Math.max(meshy.bbox.size[0], meshy.bbox.size[1])
    const rockXY = Math.max(rocktopus.bbox.size[0], rocktopus.bbox.size[1])
    expect(rockXY).toBeCloseTo(meshyXY, 0)

    // Scale factor in a sane range (Rocktopus ~65mm → Meshy ~97mm = ~1.5×)
    expect(rocktopusScale).toBeGreaterThan(1.3)
    expect(rocktopusScale).toBeLessThan(1.7)
  })

  it('alignMeshes preserves triangle count + extruder labels', () => {
    const { meshy, rocktopus } = alignMeshes(meshyMesh, rocktopusMesh)
    expect(meshy.triangleCount).toBe(meshyMesh.triangleCount)
    expect(rocktopus.triangleCount).toBe(rocktopusMesh.triangleCount)
    expect(meshy.extruders).toEqual(meshyMesh.extruders)
    expect(rocktopus.extruders).toEqual(rocktopusMesh.extruders)
  })
})
