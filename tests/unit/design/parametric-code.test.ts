import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/lib/llm/model', () => ({
  getModel: () => ({}),
  getClassifierModel: () => ({}),
}))

import { Design, type DesignInput } from '@/lib/design/schema'
import { executeParametricCode } from '@/lib/design/codegen'
import { generateFromDesign } from '@/lib/design/generate'

beforeEach(() => generateText.mockReset())

const GOOD_CODE = `
const { primitives, booleans, transforms } = jscad
function main() {
  // simple phone-stand-ish shape: base + tilted back, overlapping union
  const base = primitives.cuboid({ size: [80, 60, 5], center: [0, 0, 2.5] })
  let back = primitives.cuboid({ size: [80, 4, 70], center: [0, 0, 33] })
  back = transforms.rotateX(-0.4, back)
  back = transforms.translate([0, 20, 0], back)
  return booleans.union(base, back)
}
module.exports = { main }
`

describe('parametric_code schema', () => {
  it('accepts spec-only designs and carries optional code', () => {
    const d = Design.parse({
      kind: 'parametric_code',
      spec: 'Desk phone stand for a large phone, 62 degree backrest.',
    } satisfies DesignInput)
    expect(d.kind).toBe('parametric_code')
    expect(d).not.toHaveProperty('code', expect.any(String))

    const withCode = Design.parse({
      kind: 'parametric_code',
      spec: 'Same stand, taller lip.',
      code: GOOD_CODE,
    } satisfies DesignInput)
    if (withCode.kind !== 'parametric_code') throw new Error('wrong kind')
    expect(withCode.code).toBe(GOOD_CODE)
  })
})

describe('executeParametricCode', () => {
  it('runs valid code, grounds at z=0 and reports bbox', async () => {
    const out = await executeParametricCode(GOOD_CODE)
    expect(out.positions.length).toBeGreaterThan(0)
    expect(out.positions.length % 9).toBe(0)
    let minZ = Infinity
    for (let i = 2; i < out.positions.length; i += 3) {
      minZ = Math.min(minZ, out.positions[i])
    }
    expect(minZ).toBeCloseTo(0, 5)
    expect(out.bboxMm.x).toBeGreaterThan(70)
    expect(out.bboxMm.z).toBeGreaterThan(50)
  })

  it('rejects code without main()', async () => {
    await expect(executeParametricCode('const x = 1')).rejects.toThrow(/main\(\)/)
  })

  it('rejects parts over the print limit', async () => {
    const huge = `
      const { primitives } = jscad
      function main() { return primitives.cuboid({ size: [500, 20, 20] }) }
      module.exports = { main }
    `
    await expect(executeParametricCode(huge)).rejects.toThrow(/300mm/)
  })

  it('rejects sub-1mm parts (unit mistake)', async () => {
    const tiny = `
      const { primitives } = jscad
      function main() { return primitives.cuboid({ size: [0.5, 0.5, 0.5] }) }
      module.exports = { main }
    `
    await expect(executeParametricCode(tiny)).rejects.toThrow(/1mm/)
  })
})

describe('generateFromDesign parametric_code repair loop', () => {
  it('feeds the execution error back and succeeds on the second attempt', async () => {
    generateText
      .mockResolvedValueOnce({ text: 'const broken = (' })
      .mockResolvedValueOnce({ text: GOOD_CODE })

    const design = Design.parse({
      kind: 'parametric_code',
      spec: 'Desk phone stand.',
    } satisfies DesignInput)

    const result = await generateFromDesign(design, { logoImageBuffer: null })
    expect(generateText).toHaveBeenCalledTimes(2)
    // The second call must carry the first attempt's error as feedback.
    const secondPrompt = (generateText.mock.calls[1][0] as { prompt: string }).prompt
    expect(secondPrompt).toContain('PREVIOUS ATTEMPT FAILED')
    expect(result.bodies).toHaveLength(1)
    expect(result.bodies[0].positions.length).toBeGreaterThan(0)
    expect(result.meta.kind).toBe('parametric_code')
    // Working code is persisted back onto the design for future iterations.
    if (design.kind !== 'parametric_code') throw new Error('wrong kind')
    expect(design.code).toBe(GOOD_CODE.trim())
  })

  it('gives up with a descriptive error after 3 failed attempts', async () => {
    generateText.mockResolvedValue({ text: 'not even close to code (' })
    const design = Design.parse({
      kind: 'parametric_code',
      spec: 'Desk phone stand.',
    } satisfies DesignInput)
    await expect(generateFromDesign(design, { logoImageBuffer: null }))
      .rejects.toThrow(/3 tentativas/)
    expect(generateText).toHaveBeenCalledTimes(3)
  })
})
