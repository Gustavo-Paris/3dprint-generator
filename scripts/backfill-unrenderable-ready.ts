/**
 * One-off backfill: legacy `status='ready'` rows that have NEITHER a mesh URL
 * NOR jscad code are genuinely unrenderable — mark them `failed`. Idempotent;
 * dry-run by default.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-unrenderable-ready.ts          # dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-unrenderable-ready.ts --apply  # write
 */
import { pathToFileURL } from 'node:url'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { iterations } from '@/db/schema'

async function main() {
  const apply = process.argv.includes('--apply')
  const where = and(
    eq(iterations.status, 'ready'),
    isNull(iterations.meshBlobUrl),
    isNull(iterations.jscadCode),
  )
  const targets = await db.select({ id: iterations.id }).from(iterations).where(where)
  console.log(`[backfill] ${targets.length} unrenderable 'ready' rows`, targets.map((t) => t.id))
  if (!apply) {
    console.log("[backfill] dry-run — pass --apply to set them to 'failed'")
    return
  }
  await db.update(iterations)
    .set({ status: 'failed', error: 'backfill: ready row had neither mesh nor jscad (unrenderable)' })
    .where(where)
  console.log(`[backfill] updated ${targets.length} rows to 'failed'`)
}

// Only run when executed directly (not when imported).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
