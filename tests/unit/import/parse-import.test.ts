// tests/unit/import/parse-import.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseImportEdit } from '@/lib/design/parse-import'

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: JSON.stringify({
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [{ op: 'scale', factor: 0.5 }],
    }),
  })),
}))

vi.mock('@/lib/llm/model', () => ({
  getModel: vi.fn(() => 'mock-model'),
}))

describe('parseImportEdit', () => {
  it('returns a valid Design with imported kind', async () => {
    const result = await parseImportEdit({
      messages: ['scale it down by half'],
      baseMeshUrl: 'https://x/y.3mf',
      faces: [
        {
          id: 0,
          normal: [0, 0, 1],
          centroid: [0, 0, 15],
          areaMm2: 900,
          triangleIndices: [],
          bboxOnPlane: { min: [-15, -15], max: [15, 15] },
        },
      ],
      previewDataUrls: {
        top: 'data:image/png;base64,iVBOR',
        iso: 'data:image/png;base64,iVBOR',
        front: 'data:image/png;base64,iVBOR',
        right: 'data:image/png;base64,iVBOR',
      },
      previousDesign: null,
      bboxMm: [30, 30, 30],
    })
    expect(result.kind).toBe('imported')
    if (result.kind === 'imported') {
      expect(result.edits).toHaveLength(1)
      expect(result.edits[0]).toMatchObject({ op: 'scale', factor: 0.5 })
    }
  })

  it('strips markdown fences from LLM response', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '```json\n' + JSON.stringify({
        kind: 'imported',
        baseMeshUrl: 'https://x/y.3mf',
        edits: [],
      }) + '\n```',
    } as Awaited<ReturnType<typeof generateText>>)

    const result = await parseImportEdit({
      messages: ['no change'],
      baseMeshUrl: 'https://x/y.3mf',
      faces: [],
      previewDataUrls: {
        top: 'data:image/png;base64,iVBOR',
        iso: 'data:image/png;base64,iVBOR',
        front: 'data:image/png;base64,iVBOR',
        right: 'data:image/png;base64,iVBOR',
      },
      previousDesign: null,
      bboxMm: [30, 30, 30],
    })
    expect(result.kind).toBe('imported')
  })

  it('throws on invalid JSON from LLM (both the first attempt and the repair re-ask)', async () => {
    const { generateText } = await import('ai')
    // Bad output for BOTH calls — the repair re-ask also fails, so it throws.
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: 'not json at all' } as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({ text: 'still not json' } as Awaited<ReturnType<typeof generateText>>)

    await expect(
      parseImportEdit({
        messages: ['test'],
        baseMeshUrl: 'https://x/y.3mf',
        faces: [],
        previewDataUrls: {
          top: 'data:image/png;base64,iVBOR',
          iso: 'data:image/png;base64,iVBOR',
          front: 'data:image/png;base64,iVBOR',
          right: 'data:image/png;base64,iVBOR',
        },
        previousDesign: null,
        bboxMm: [30, 30, 30],
      }),
    ).rejects.toThrow(/bad JSON/i)
  })

  it('throws on schema mismatch from LLM (both the first attempt and the repair re-ask)', async () => {
    const { generateText } = await import('ai')
    // Schema-invalid for BOTH calls — the repair re-ask also fails, so it throws.
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ kind: 'unknown_kind', whatever: true }) } as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({ text: JSON.stringify({ kind: 'unknown_kind', whatever: true }) } as Awaited<ReturnType<typeof generateText>>)

    await expect(
      parseImportEdit({
        messages: ['test'],
        baseMeshUrl: 'https://x/y.3mf',
        faces: [],
        previewDataUrls: {
          top: 'data:image/png;base64,iVBOR',
          iso: 'data:image/png;base64,iVBOR',
          front: 'data:image/png;base64,iVBOR',
          right: 'data:image/png;base64,iVBOR',
        },
        previousDesign: null,
        bboxMm: [30, 30, 30],
      }),
    ).rejects.toThrow(/schema mismatch/i)
  })
})
