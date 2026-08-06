import { describe, it, expect, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { findOrCreateUser } from '@/lib/auth/find-or-create-user'

/**
 * Regression for the e2e login flake: concurrent sign-ins as the same new email
 * must not collide on the UNIQUE(email) constraint. Hits the real DB (the same
 * Postgres the integration suite uses).
 */
describe('findOrCreateUser', () => {
  const emails: string[] = []
  afterEach(async () => {
    for (const e of emails) await db.delete(users).where(eq(users.email, e))
    emails.length = 0
  })

  /**
   * Historical root cause (kept as a comment, not a flaky assertion): a naive
   * findFirst → insert races on UNIQUE(email). Under light load the race often
   * does NOT fire, so asserting "at least one rejection" was red on CI even
   * though production already uses ON CONFLICT (findOrCreateUser). The real
   * gate is the concurrent-safe test below.
   */

  it('resolves concurrent first-logins to a single user without throwing', async () => {
    const email = `race-safe-${randomUUID()}@example.com`
    emails.push(email)

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => findOrCreateUser(email)),
    )

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0)
    const ids = new Set(
      results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id),
    )
    expect(ids.size).toBe(1)

    const rows = await db.select().from(users).where(eq(users.email, email))
    expect(rows).toHaveLength(1)
  })
})
