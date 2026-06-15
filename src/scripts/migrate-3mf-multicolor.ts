/**
 * Migrate already-persisted multi-body 3MFs to the current Bambu-compatible
 * format (welded geometry + <m:colorgroup>). Old files used core-spec
 * basematerials, which Bambu loads as a single colour, and an unwelded triangle
 * soup, which Bambu flags as non-manifold. Re-serializing fixes both.
 *
 * In-place and idempotent: parse3mf reads both old and new layouts, the file
 * path (and therefore its meshBlobUrl) is unchanged, and files already in the
 * new format are skipped. Single-body meshes (no colour split) are left alone.
 *
 * Usage: tsx src/scripts/migrate-3mf-multicolor.ts [dir]   (default public/meshes)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { parse3mf } from '../lib/3mf/parse-3mf'
import { serialize3mf } from '../lib/3mf/serialize-3mf'

const dir = process.argv[2] ?? join(process.cwd(), 'public/meshes')

function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b // "PK"
}

/** Already new-format if the model XML carries a colour group. */
function isNewFormat(bytes: Uint8Array): boolean {
  try {
    const model = unzipSync(bytes)['3D/3dmodel.model']
    return !!model && new TextDecoder().decode(model).includes('m:colorgroup')
  } catch {
    return false
  }
}

let converted = 0, skipped = 0, failed = 0
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.3mf')) continue
  const path = join(dir, name)
  try {
    const bytes = new Uint8Array(readFileSync(path))
    if (!isZip(bytes)) { skipped++; continue }            // STL saved with .3mf name
    if (isNewFormat(bytes)) { skipped++; continue }       // nothing to do

    const bodies = parse3mf(bytes)
    if (bodies.length <= 1) { skipped++; continue }       // single colour — leave as-is

    writeFileSync(path, serialize3mf(bodies))
    converted++
    console.log(`✓ ${name} — ${bodies.length} bodies (${bodies.map(b => b.extruder).join('+')})`)
  } catch (e) {
    failed++
    console.error(`✗ ${name}: ${(e as Error).message}`)
  }
}

console.log(`\ndone: ${converted} converted, ${skipped} skipped, ${failed} failed`)
