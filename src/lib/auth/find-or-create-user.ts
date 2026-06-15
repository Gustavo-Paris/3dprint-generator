import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

export type AppUser = typeof users.$inferSelect

/**
 * Idempotent, concurrency-safe "get the user for this email, creating it if
 * needed".
 *
 * A naive `findFirst` → `if (!user) insert` races: two callers logging in with
 * the same brand-new email at the same moment both miss the read, both INSERT,
 * and the second hits the `UNIQUE(email)` constraint and throws. That actually
 * happened — the e2e suite runs 2 Playwright workers that all sign in as the
 * same allowed email against a fresh CI database, so the first two concurrent
 * logins collided, one route returned 500, and `waitForURL('/')` timed out.
 *
 * `INSERT … ON CONFLICT (email) DO NOTHING` makes creation atomic. On conflict
 * the insert returns no row, so we read back the row the winning caller
 * committed (its INSERT has committed by the time our conflicting INSERT
 * returns, because it held the row lock).
 */
export async function findOrCreateUser(email: string): Promise<AppUser> {
  const normalised = email.toLowerCase().trim()

  const [created] = await db
    .insert(users)
    .values({ email: normalised })
    .onConflictDoNothing({ target: users.email })
    .returning()
  if (created) return created

  const existing = await db.query.users.findFirst({ where: eq(users.email, normalised) })
  if (!existing) {
    // The conflict says a row exists; not finding it means a delete raced in
    // between, which never happens for sign-in. Surface it rather than mask it.
    throw new Error(`findOrCreateUser: no user after conflict for "${normalised}"`)
  }
  return existing
}
