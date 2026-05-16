import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/llm/model', () => ({
  getClassifierModel: () => 'mock' as unknown,
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { generateText } from 'ai'
import { synthesizeIterationPrompt } from '@/lib/prompt/synthesize-iteration'

describe('synthesizeIterationPrompt', () => {
  it('passes both image description and messages to the LLM', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'a trophy of the PG logo' })
    const result = await synthesizeIterationPrompt({
      imageDescription: 'PG monogram in red, stylized',
      messages: ['trofeu da nossa logo', 'vazado nas letras'],
    })
    expect(result).toBe('a trophy of the PG logo')

    const call = (generateText as any).mock.calls[(generateText as any).mock.calls.length - 1]
    const arg = call[0] as { prompt: string; system: string }
    expect(arg.prompt).toContain('PG monogram in red, stylized')
    expect(arg.prompt).toContain('trofeu da nossa logo')
    expect(arg.prompt).toContain('vazado nas letras')
  })

  it('returns the image description verbatim when there are no messages', async () => {
    const desc = 'A red PG monogram on black background'
    const result = await synthesizeIterationPrompt({ imageDescription: desc, messages: [] })
    expect(result).toBe(desc)
  })

  it('trims the LLM output', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: '  trophy of paçoca logo  \n\n' })
    const result = await synthesizeIterationPrompt({
      imageDescription: 'logo',
      messages: ['troféu'],
    })
    expect(result).toBe('trophy of paçoca logo')
  })
})
