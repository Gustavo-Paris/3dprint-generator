import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/lib/llm/model', () => ({ getModel: () => ({}) }))

import { parseImportEdit } from '@/lib/design/parse-import'

const input = {
  messages: ['logo na frente'],
  baseMeshUrl: '/x.3mf',
  faces: [],
  previewDataUrls: { top: 'd', front: 'd', right: 'd', iso: 'd' },
  previousDesign: null,
  bboxMm: [10, 10, 10] as [number, number, number],
}

beforeEach(() => generateText.mockReset())

describe('parseImportEdit resilience', () => {
  it('passes a 60s abortSignal on the first call', async () => {
    generateText.mockResolvedValueOnce({ text: '{"kind":"imported","baseMeshUrl":"/x.3mf","edits":[]}' })
    await parseImportEdit(input)
    expect(generateText.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('re-asks once on invalid JSON then succeeds', async () => {
    generateText
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: '{"kind":"imported","baseMeshUrl":"/x.3mf","edits":[]}' })
    const d = await parseImportEdit(input)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(d.kind).toBe('imported')
  })
})
