import { del, put } from '@vercel/blob'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '@/env'

/**
 * Persist a generated mesh and return a URL the viewer/slicer can load.
 *
 * Blob-or-local: writes to Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else
 * to public/meshes/ for local dev. The extension + content-type are derived from
 * the bytes (3MF is a ZIP — `PK\x03\x04` magic — everything else is treated as
 * binary STL), so a single call site handles both the parametric .stl and the
 * multi-body .3mf path.
 *
 * Key layout: `${userId}/${projectId}/${iterationId}.${ext}` (Blob) or
 * `/meshes/${iterationId}.${ext}` (local).
 */
export async function persistMesh(
  bytes: Uint8Array,
  userId: string,
  projectId: string,
  iterationId: string,
): Promise<string> {
  const is3mf = bytes[0] === 0x50 && bytes[1] === 0x4b
  const ext = is3mf ? '3mf' : 'stl'
  const contentType = is3mf ? 'application/octet-stream' : 'model/stl'
  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${userId}/${projectId}/${iterationId}.${ext}`, Buffer.from(bytes), {
      access: 'public',
      addRandomSuffix: false,
      contentType,
    })
    return blob.url
  }
  const dir = join(process.cwd(), 'public', 'meshes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${iterationId}.${ext}`), Buffer.from(bytes))
  return `/meshes/${iterationId}.${ext}`
}

/** Delete a persisted asset (mesh, sliced 3MF, uploaded image, or imported base).
 *  http(s) → Vercel blob; local '/meshes/...' or '/uploads/...' → public file.
 *  Swallows "already gone" so the orphan-sweep stays idempotent. */
export async function delMesh(meshUrl: string): Promise<void> {
  if (meshUrl.startsWith('http')) {
    await del(meshUrl, { token: env.BLOB_READ_WRITE_TOKEN })
    return
  }
  if (meshUrl.startsWith('/meshes/') || meshUrl.startsWith('/uploads/')) {
    const abs = join(process.cwd(), 'public', meshUrl.replace(/^\//, ''))
    await unlink(abs).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e
    })
  }
}
