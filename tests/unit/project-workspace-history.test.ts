import { describe, it, expect } from 'vitest'
import { mapHistoryToMessages } from '@/components/ProjectWorkspace'

const row = (over: Record<string, unknown>) =>
  ({ id: 'i1', userMessage: 'faz um chaveiro', imageBlobUrl: null, jscadCode: null,
     validationReport: null, strategy: 'generative', status: 'ready', error: null, ...over }) as never

describe('mapHistoryToMessages', () => {
  it('renders a failed row as an error bubble, not "Generated"', () => {
    const msgs = mapHistoryToMessages([
      row({ status: 'failed', error: 'Não foi possível interpretar o pedido.' }),
    ])
    const assistant = msgs.find((m) => m.role === 'assistant')!
    expect(assistant.status).toBe('failed')
    expect(assistant.text).not.toBe('Generated')
    expect(assistant.text).toContain('interpretar')
  })

  it('sanitizes technical SQL/stack dumps from failed history (BUG-009)', () => {
    const msgs = mapHistoryToMessages([
      row({
        status: 'failed',
        error: 'insert into "users" violates unique constraint\n    at Object.query (/Users/x/app.ts:1:1)',
      }),
    ])
    const assistant = msgs.find((m) => m.role === 'assistant')!
    expect(assistant.text).toMatch(/^Falhou:/)
    expect(assistant.text).not.toMatch(/insert into/i)
    expect(assistant.text).not.toMatch(/\/Users\//)
  })
  it('renders an in-flight row as generating', () => {
    const msgs = mapHistoryToMessages([row({ status: 'generating', error: null })])
    expect(msgs.find((m) => m.role === 'assistant')!.status).toBe('generating')
  })
  it('renders a ready generative row normally', () => {
    const msgs = mapHistoryToMessages([row({ status: 'ready', meshBlobUrl: '/meshes/x.stl' })])
    expect(msgs.find((m) => m.role === 'assistant')!.status).toBe('ready')
  })

  it('renders ready imported mesh rows (strategy imported + meshBlobUrl)', () => {
    const msgs = mapHistoryToMessages([
      row({
        status: 'ready',
        strategy: 'imported',
        meshBlobUrl: '/meshes/x.3mf',
        validationReport: { kind: 'imported', baseMeshUrl: '/u.3mf', edits: [{ op: 'paint_region', extruder: 'B', region: 'upper_half' }] },
      }),
    ])
    const a = msgs.find((m) => m.role === 'assistant')!
    expect(a.status).toBe('ready')
    expect(a.text).toMatch(/importada/i)
    expect((a.design as { kind: string }).kind).toBe('imported')
  })
})
