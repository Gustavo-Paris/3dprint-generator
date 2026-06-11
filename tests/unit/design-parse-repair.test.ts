import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/lib/llm/model', () => ({ getClassifierModel: () => ({}) }))

import { parseDesign } from '@/lib/design/parse'

beforeEach(() => generateText.mockReset())

describe('parseDesign resilience', () => {
  it('passes a 60s abortSignal and parses on first try', async () => {
    generateText.mockResolvedValueOnce({ text: '{"kind":"disc","diameterMm":50}' })
    const d = await parseDesign({ messages: ['disco 50'], imageDescription: null })
    expect(d.kind).toBe('disc')
    expect(generateText.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('re-asks once on invalid JSON then succeeds', async () => {
    generateText
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: '{"kind":"disc","diameterMm":50}' })
    const d = await parseDesign({ messages: ['disco 50'], imageDescription: null })
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(d.kind).toBe('disc')
  })

  it('throws after the repair re-ask also fails', async () => {
    generateText.mockResolvedValue({ text: 'still garbage' })
    await expect(parseDesign({ messages: ['x'], imageDescription: null })).rejects.toThrow()
    expect(generateText).toHaveBeenCalledTimes(2)
  })
})
