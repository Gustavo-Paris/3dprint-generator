import { describe, it, expect } from 'vitest'
import { resolveViewableRow } from '@/components/ProjectWorkspace'

const row = (id: string, status: string) => ({ id, status }) as never

describe('resolveViewableRow (chat → viewer version navigation)', () => {
  const history = [row('a', 'ready'), row('b', 'failed'), row('c', 'sliced'), row('d', 'generating')]

  it('resolves ready and sliced rows', () => {
    expect(resolveViewableRow(history, 'a')).toEqual({ id: 'a', status: 'ready' })
    expect(resolveViewableRow(history, 'c')).toEqual({ id: 'c', status: 'sliced' })
  })
  it('returns null for failed/generating rows (nothing to show)', () => {
    expect(resolveViewableRow(history, 'b')).toBeNull()
    expect(resolveViewableRow(history, 'd')).toBeNull()
  })
  it('returns null for ids not in the page-load history (live-session iterations)', () => {
    expect(resolveViewableRow(history, 'zzz')).toBeNull()
  })
})
