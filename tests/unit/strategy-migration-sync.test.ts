/**
 * Guardrail for the failure this test was born from: `iterations_strategy_check`
 * is GENERATED from the `iterationStrategies` TS enum, so adding a Design kind
 * without running `pnpm db:generate` ships an app that builds the mesh and then
 * fails the finalize UPDATE in production.
 *
 * Every strategy value must appear in the latest CHECK constraint emitted into
 * drizzle/, and every Design kind must be a valid strategy.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { iterationStrategies } from '@/db/strategy'

const DRIZZLE_DIR = join(process.cwd(), 'drizzle')

/** Newest migration that (re)defines iterations_strategy_check. */
function latestStrategyCheckSql(): string {
  const files = readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()
  for (const f of files) {
    const sql = readFileSync(join(DRIZZLE_DIR, f), 'utf8')
    if (sql.includes('iterations_strategy_check') && sql.includes('CHECK')) return sql
  }
  throw new Error('no migration defines iterations_strategy_check')
}

describe('strategy enum ↔ migration sync', () => {
  it('every iterationStrategies value is in the latest CHECK constraint', () => {
    const sql = latestStrategyCheckSql()
    const missing = iterationStrategies.filter((s) => !sql.includes(`'${s}'`))
    expect(
      missing,
      `run \`pnpm db:generate\` — these strategies have no migration: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('every Design kind is a known strategy', async () => {
    const { Design } = await import('@/lib/design/schema')
    const kinds = Design.options.map((o) => o.shape.kind.value as string)
    const unknown = kinds.filter((k) => !(iterationStrategies as readonly string[]).includes(k))
    expect(
      unknown,
      `add these kinds to iterationStrategies (src/db/strategy.ts): ${unknown.join(', ')}`,
    ).toEqual([])
  })
})
