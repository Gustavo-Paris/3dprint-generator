import { describe, it, expect } from 'vitest'
import { reapStuckIterations } from '@/lib/db/reap-stuck-iterations'

describe('reapStuckIterations', () => {
  it('marks generating rows older than the cutoff as failed', async () => {
    const calls: unknown[] = []
    const fakeDb = {
      update: () => ({
        set: (v: unknown) => {
          calls.push(v)
          return { where: () => ({ returning: async () => [{ id: 'a' }, { id: 'b' }] }) }
        },
      }),
    } as never
    const reaped = await reapStuckIterations(fakeDb, 15)
    expect(reaped).toBe(2)
    expect(calls[0]).toMatchObject({ status: 'failed' })
    expect((calls[0] as { error?: string }).error).toMatch(/stuck|generating|15/i)
  })
})
