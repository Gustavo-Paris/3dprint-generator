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

  it('documents the naive check-then-insert race (root cause)', async () => {
    const email = `race-naive-${randomUUID()}@example.com`
    emails.push(email)

    const naive = () =>
      db.query.users.findFirst({ where: eq(users.email, email) }).then(async (u) => {
        if (u) return u.id
        const [ins] = await db.insert(users).values({ email }).returning()
        return ins.id
      })

    const results = await Promise.allSettled(Array.from({ length: 8 }, naive))
    // At least one concurrent INSERT loses the unique-constraint race.
    expect(results.some((r) => r.status === 'rejected')).toBe(true)
  })

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
