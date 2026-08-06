/**
 * Orphan-mesh sweep (private mesh store + legacy public/meshes).
 *
 * Lists mesh files on disk with no matching `iterations.mesh_blob_url` and, with
 * `--apply`, deletes them via delMesh(). Dry-run by default. Production blobs
 * would need a `@vercel/blob` list() pass — out of scope (data hygiene, no UI).
 *
 *   pnpm meshes:sweep
 *   pnpm meshes:sweep:apply
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { iterations } from '@/db/schema'
import { delMesh } from '@/lib/storage/persist'
import { findOrphans } from '@/lib/storage/orphans'
import { meshStorageDir } from '@/lib/storage/local-asset'

async function main() {
  const apply = process.argv.includes('--apply')
  const dirs = [
    meshStorageDir(),
    join(process.cwd(), 'public', 'meshes'), // legacy
  ]
  const diskSet = new Set<string>()
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => [] as string[])
    for (const n of names) diskSet.add(n)
  }
  const disk = [...diskSet]
  const rows = await db
    .select({ url: iterations.meshBlobUrl })
    .from(iterations)
    .where(isNotNull(iterations.meshBlobUrl))
  const orphans = findOrphans(disk, rows.map((r) => r.url!).filter(Boolean))
  console.log(`[sweep] ${disk.length} files on disk, ${rows.length} referenced, ${orphans.length} orphans`)
  for (const f of orphans) console.log('  orphan:', f)
  if (!apply) {
    console.log('[sweep] dry-run — pass --apply to delete the orphans')
    return
  }
  for (const f of orphans) await delMesh(`/meshes/${f}`)
  console.log(`[sweep] deleted ${orphans.length} orphan files`)
}

// Only run when executed directly (not when a test imports this module).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
