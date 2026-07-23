import { describe, it, expect } from 'vitest'
import { isViewableVersion } from '@/components/Chat'

describe('isViewableVersion ("Ver esta versão" gate)', () => {
  it('accepts assistant messages with iterationId and status ready', () => {
    expect(
      isViewableVersion({ role: 'assistant', iterationId: 'i1', status: 'ready' }),
    ).toBe(true)
  })
  it('accepts sliced rows too', () => {
    expect(
      isViewableVersion({ role: 'assistant', iterationId: 'i1', status: 'sliced' }),
    ).toBe(true)
  })
  it('rejects failed and generating rows', () => {
    expect(
      isViewableVersion({ role: 'assistant', iterationId: 'i1', status: 'failed' }),
    ).toBe(false)
    expect(
      isViewableVersion({ role: 'assistant', iterationId: 'i1', status: 'generating' }),
    ).toBe(false)
  })
  it('rejects live-session messages without status (not reloadable from history)', () => {
    expect(isViewableVersion({ role: 'assistant', iterationId: 'i1' })).toBe(false)
  })
  it('rejects user messages and messages without iterationId', () => {
    expect(isViewableVersion({ role: 'user', iterationId: 'i1', status: 'ready' })).toBe(false)
    expect(isViewableVersion({ role: 'assistant', status: 'ready' })).toBe(false)
  })
})
