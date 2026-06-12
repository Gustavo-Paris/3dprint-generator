import { describe, it, expect } from 'vitest'
import { Body as GenerateBody } from '@/app/api/generate/body-schema'

describe('generate request body caps', () => {
  it('rejects an oversized preview data URL', () => {
    const big = 'd'.repeat(8 * 1024 * 1024 + 1)
    const r = GenerateBody.safeParse({
      projectId: crypto.randomUUID(),
      message: 'x',
      previewDataUrls: { top: big, front: 'x', right: 'x', iso: 'x' },
    })
    expect(r.success).toBe(false)
  })
  it('accepts previews under the cap', () => {
    const r = GenerateBody.safeParse({
      projectId: crypto.randomUUID(),
      message: 'x',
      previewDataUrls: { top: 'x', front: 'x', right: 'x', iso: 'x' },
    })
    expect(r.success).toBe(true)
  })
})
