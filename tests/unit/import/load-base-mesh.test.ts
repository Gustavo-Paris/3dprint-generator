import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'

let cubeBytes: Uint8Array

beforeAll(async () => {
  cubeBytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')),
  )
})

describe('loadBaseMeshFromBytes', () => {
  it('parses a 30mm cube into 12 triangles', async () => {
    const mesh = await loadBaseMeshFromBytes(cubeBytes)
    expect(mesh.triangleCount).toBe(12)
    expect(mesh.positions.length).toBe(12 * 9)
  })

  it('computes bbox of the 30mm cube as 30×30×30', async () => {
    const mesh = await loadBaseMeshFromBytes(cubeBytes)
    expect(mesh.bbox.size[0]).toBeCloseTo(30, 1)
    expect(mesh.bbox.size[1]).toBeCloseTo(30, 1)
    expect(mesh.bbox.size[2]).toBeCloseTo(30, 1)
  })

  it('computes one unit normal per triangle', async () => {
    const mesh = await loadBaseMeshFromBytes(cubeBytes)
    expect(mesh.normals.length).toBe(12 * 3)
    for (let i = 0; i < 12; i++) {
      const nx = mesh.normals[i * 3], ny = mesh.normals[i * 3 + 1], nz = mesh.normals[i * 3 + 2]
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      expect(len).toBeCloseTo(1, 4)
    }
  })

  it('throws on invalid input', async () => {
    await expect(loadBaseMeshFromBytes(new Uint8Array([1, 2, 3])))
      .rejects.toThrow()
  })
})
