import { describe, it, expect } from 'vitest'
import { runJscad } from '@/lib/jscad/runner'

describe('runJscad', () => {
  it('returns triangle positions for a cuboid', async () => {
    const code = `
      const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] })
      module.exports = { main }
    `
    const r = await runJscad(code)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.positions.length).toBeGreaterThan(0)
      expect(r.positions.length % 9).toBe(0)
      expect(r.triangleCount).toBeGreaterThan(0)
    }
  })

  it('reports a syntax error cleanly', async () => {
    const r = await runJscad('this is not (valid javascript')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toMatch(/syntax|unexpected/)
  })

  it('rejects code that does not export main()', async () => {
    const r = await runJscad('module.exports = {}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toContain('main')
  })

  it('rejects code whose main() returns a non-geometry value', async () => {
    const r = await runJscad('const main = () => 42; module.exports = { main }')
    expect(r.ok).toBe(false)
  })
})
