import { describe, it, expect, afterEach } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { persistMesh } from '@/lib/storage/persist'
import { meshWritePath } from '@/lib/storage/local-asset'

// No BLOB_READ_WRITE_TOKEN in the test env → exercises the local-write branch.
const written: string[] = []
afterEach(async () => {
  for (const f of written) await rm(f, { force: true })
  written.length = 0
})

describe('persistMesh (local fallback)', () => {
  it('writes a binary STL as .stl under the private mesh store', async () => {
    const stl = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    const url = await persistMesh(stl, 'u1', 'p1', 'iter-stl')
    expect(url).toBe('/meshes/iter-stl.stl')
    const onDisk = meshWritePath('iter-stl.stl')
    written.push(onDisk)
    expect(new Uint8Array(await readFile(onDisk))).toEqual(stl)
  })

  it('detects a 3MF (PK zip magic) and writes .3mf', async () => {
    const tmf = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const url = await persistMesh(tmf, 'u1', 'p1', 'iter-3mf')
    expect(url).toBe('/meshes/iter-3mf.3mf')
    written.push(meshWritePath('iter-3mf.3mf'))
  })
})
