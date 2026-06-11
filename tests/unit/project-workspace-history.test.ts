import { describe, it, expect } from 'vitest'
import { mapHistoryToMessages } from '@/components/ProjectWorkspace'

const row = (over: Record<string, unknown>) =>
  ({ id: 'i1', userMessage: 'faz um chaveiro', imageBlobUrl: null, jscadCode: null,
     validationReport: null, strategy: 'generative', status: 'ready', error: null, ...over }) as never

describe('mapHistoryToMessages', () => {
  it('renders a failed row as an error bubble, not "Generated"', () => {
    const msgs = mapHistoryToMessages([row({ status: 'failed', error: 'design parse failed: boom' })])
    const assistant = msgs.find((m) => m.role === 'assistant')!
    expect(assistant.status).toBe('failed')
    expect(assistant.text).not.toBe('Generated')
    expect(assistant.text).toContain('boom')
  })
  it('renders an in-flight row as generating', () => {
    const msgs = mapHistoryToMessages([row({ status: 'generating', error: null })])
    expect(msgs.find((m) => m.role === 'assistant')!.status).toBe('generating')
  })
  it('renders a ready generative row normally', () => {
    const msgs = mapHistoryToMessages([row({ status: 'ready' })])
    expect(msgs.find((m) => m.role === 'assistant')!.status).toBe('ready')
  })
})
