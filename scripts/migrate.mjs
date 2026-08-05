/**
 * Production migration runner — used by Railway's preDeployCommand.
 *
 * Deliberately uses drizzle-orm's migrator (a runtime dependency) instead of
 * `drizzle-kit migrate` (a devDependency that a pruned production install may
 * not ship). Reads the same ./drizzle folder drizzle-kit generates.
 *
 * Fails loudly: a non-zero exit aborts the deploy and the previous release
 * keeps serving, which is the behaviour we want for a bad migration.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL is not set')
  process.exit(1)
}

// max:1 — migrations must run on a single connection, in order.
const client = postgres(url, { max: 1 })

try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' })
  console.log('[migrate] migrations applied')
  await client.end()
  process.exit(0)
} catch (err) {
  console.error('[migrate] FAILED:', err)
  await client.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
}
