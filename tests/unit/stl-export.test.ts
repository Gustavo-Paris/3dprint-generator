import { describe, it, expect } from 'vitest'
import { runJscad } from '@/lib/jscad/runner'

describe('runJscad STL export', () => {
  it('produces binary STL bytes for a cuboid', async () => {
    const code = `const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] })\nmodule.exports = { main }`
    const r = await runJscad(code)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.stl).toBeInstanceOf(Uint8Array)
      // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes/triangle.
      // A cube triangulated has 12 triangles → 84 + 50*12 = 684 bytes.
      expect(r.stl.byteLength).toBe(684)
      const dv = new DataView(r.stl.buffer, r.stl.byteOffset, r.stl.byteLength)
      expect(dv.getUint32(80, true)).toBe(12)
    }
  })
})
