import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  loadBaseMeshFromBytes,
  looksLikeBinaryStl,
} from '@/lib/import/load-base-mesh'

let cubeBytes: Uint8Array

beforeAll(async () => {
  cubeBytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')),
  )
})

function makeBinaryStl(triCount: number): Uint8Array {
  const buf = new ArrayBuffer(84 + 50 * triCount)
  const dv = new DataView(buf)
  dv.setUint32(80, triCount, true)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    // triangle (0,0,0)-(1,0,0)-(0,1,0) shifted by i on X
    dv.setFloat32(base + 12, i, true)
    dv.setFloat32(base + 16, 0, true)
    dv.setFloat32(base + 20, 0, true)
    dv.setFloat32(base + 24, i + 1, true)
    dv.setFloat32(base + 28, 0, true)
    dv.setFloat32(base + 32, 0, true)
    dv.setFloat32(base + 36, i, true)
    dv.setFloat32(base + 40, 1, true)
    dv.setFloat32(base + 44, 0, true)
  }
  return new Uint8Array(buf)
}

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

  it('parses binary STL (Meshy freeform) into a BaseMesh', async () => {
    const stl = makeBinaryStl(3)
    expect(looksLikeBinaryStl(stl)).toBe(true)
    const mesh = await loadBaseMeshFromBytes(stl)
    expect(mesh.triangleCount).toBe(3)
    expect(mesh.positions.length).toBe(27)
    expect(mesh.extruders.every((e) => e === 'A')).toBe(true)
  })

  it('does not treat 3MF zip as STL', () => {
    expect(looksLikeBinaryStl(cubeBytes)).toBe(false)
  })

  it('throws on invalid input', async () => {
    await expect(loadBaseMeshFromBytes(new Uint8Array([1, 2, 3])))
      .rejects.toThrow()
  })
})
