import { del } from '@vercel/blob'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '@/env'

/** Delete a persisted mesh. http(s) → Vercel blob; '/meshes/...' → local file.
 *  Swallows "already gone" so the orphan-sweep stays idempotent. */
export async function delMesh(meshUrl: string): Promise<void> {
  if (meshUrl.startsWith('http')) {
    await del(meshUrl, { token: env.BLOB_READ_WRITE_TOKEN })
    return
  }
  if (meshUrl.startsWith('/meshes/')) {
    const abs = join(process.cwd(), 'public', meshUrl.replace(/^\//, ''))
    await unlink(abs).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e
    })
  }
}
