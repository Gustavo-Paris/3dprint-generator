import { and, eq, lt, sql } from 'drizzle-orm'
import { iterations } from '@/db/schema'
import type { db as Db } from '@/db'

/** Sweep iterations stuck in 'generating' past `minutes` → 'failed'. Idempotent;
 *  safe to call on any route hit. A cron job can call the same function. */
export async function reapStuckIterations(db: typeof Db, minutes = 15): Promise<number> {
  const rows = await db
    .update(iterations)
    .set({ status: 'failed', error: `reaper: stuck in 'generating' > ${minutes} min` })
    .where(
      and(
        eq(iterations.status, 'generating'),
        lt(iterations.createdAt, sql`now() - (${minutes} || ' minutes')::interval`),
      ),
    )
    .returning({ id: iterations.id })
  return rows.length
}
