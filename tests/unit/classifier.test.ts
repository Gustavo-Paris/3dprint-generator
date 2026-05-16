import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/llm/model', () => ({
  getClassifierModel: () => 'mocked-model' as any,
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { generateText } from 'ai'
import { classifyIntent } from '@/lib/prompt/classify'

describe('classifyIntent', () => {
  it('returns "generative" when classifier responds with g', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'g' })
    const r = await classifyIntent('iron man helmet real size')
    expect(r).toBe('generative')
  })

  it('returns "parametric" when classifier responds with p', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'p' })
    const r = await classifyIntent('a 40mm cube with a 10mm hole')
    expect(r).toBe('parametric')
  })

  it('defaults to parametric on ambiguous output', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'maybe both?' })
    const r = await classifyIntent('something weird')
    expect(r).toBe('parametric')
  })

  it('defaults to parametric on LLM error', async () => {
    ;(generateText as any).mockRejectedValueOnce(new Error('LLM down'))
    const r = await classifyIntent('whatever')
    expect(r).toBe('parametric')
  })
})
