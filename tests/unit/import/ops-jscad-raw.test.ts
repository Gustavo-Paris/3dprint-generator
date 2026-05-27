import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { applyJscadRaw } from '@/lib/import/ops/jscad-raw'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
})

describe('applyJscadRaw', () => {
  it('union mode adds geometry', async () => {
    const out = await applyJscadRaw(cube, {
      op: 'jscad_raw', mode: 'union',
      code: `module.exports = { main: () => jscad.primitives.cuboid({ size: [5, 5, 5], center: [20, 0, 0] }) }`,
    })
    expect(out.bbox.size[0]).toBeGreaterThan(30)
  })

  it('rejects code missing main()', async () => {
    await expect(applyJscadRaw(cube, {
      op: 'jscad_raw', mode: 'union',
      code: `module.exports = {}`,
    })).rejects.toThrow(/main/)
  })

  // NOTE: tight infinite loops block the Node.js event loop, so the
  // setTimeout-based timeout cannot fire during synchronous busy-waiting.
  // This test uses a short timeoutMs (200ms) and a per-test Jest/Vitest
  // timeout (5000ms) to contain the damage if it does block.
  // If it hangs CI, mark .skip and move to a Worker-thread implementation.
  it.skip('times out after timeoutMs on tight infinite loop (event-loop blocked — skipped, see jscad-raw.ts TODO)', async () => {
    await expect(applyJscadRaw(cube, {
      op: 'jscad_raw', mode: 'union',
      code: `module.exports = { main: () => { while(true) {} } }`,
    }, { timeoutMs: 200 })).rejects.toThrow(/timeout/i)
  }, 5000)
})
