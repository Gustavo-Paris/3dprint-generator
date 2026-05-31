/**
 * Integration test for the flexify orchestration: given an existing mesh and the
 * bundled Rocktopus reference, the pipeline must produce a multi-body articulated
 * 3MF. This exercises the same code path /api/flexify uses (loadBaseMeshFromUrl →
 * flexify → serialize), without spinning up the HTTP layer or the DB.
 *
 * Uses the real fixtures (no Meshy credits needed), so it proves Phase B is wired
 * even while the Meshy account is out of funds.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { flexify } from '@/lib/flexify'
import { parse3mf } from '@/lib/3mf/parse-3mf'

let meshyBytes: Uint8Array
let rocktopusBytes: Uint8Array

beforeAll(async () => {
  meshyBytes = new Uint8Array(await readFile(join(__dirname, '../fixtures/meshy-mascot.3mf')))
  // The bundled reference the /api/flexify route loads from public/refs/.
  rocktopusBytes = new Uint8Array(
    await readFile(join(process.cwd(), 'public/refs/rocktopus-reference.3mf')),
  )
})

describe('flexify orchestration (Phase B)', () => {
  it('bundles the Rocktopus reference under public/refs', async () => {
    expect(rocktopusBytes.byteLength).toBeGreaterThan(1000)
  })

  it('produces a multi-body articulated 3MF from a mesh + the reference', async () => {
    const { bytes, report } = await flexify(meshyBytes, rocktopusBytes)

    // The report is the source of truth for body/joint counts (parse3mf is a
    // lossy reader that concatenates all <object> bodies into one mesh on the
    // way back in — it does not preserve the multi-body split).
    expect(report.componentCount).toBeGreaterThan(1) // articulated (≈41 for Rocktopus)
    expect(report.jointCount).toBeGreaterThan(0)     // ball-and-socket joints
    expect(report.totalTriangles).toBeGreaterThan(0)

    // Output is a valid, non-trivial 3MF (a zip that parse3mf can read back).
    expect(bytes.byteLength).toBeGreaterThan(1000)
    const bodies = parse3mf(bytes)
    expect(bodies.length).toBeGreaterThanOrEqual(1)
    expect(bodies[0].positions.length).toBeGreaterThan(0)
  }, 120_000)
})
