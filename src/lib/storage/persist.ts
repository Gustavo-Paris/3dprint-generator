import { del, put } from '@vercel/blob'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { env } from '@/env'
import { meshWritePath, resolveLocalAssetPath } from '@/lib/storage/local-asset'

/**
 * Persist a generated mesh and return a URL the viewer/slicer can load.
 *
 * Blob-or-local: writes to Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else
 * to the private mesh dir (MESH_STORAGE_DIR or `.data/meshes`) — NOT under
 * public/, so Next never serves meshes without auth. The extension + content-type
 * are derived from the bytes (3MF is a ZIP — `PK\x03\x04` magic — everything else
 * is treated as binary STL).
 *
 * Key layout: `${userId}/${projectId}/${iterationId}.${ext}` (Blob) or
 * `/meshes/${iterationId}.${ext}` (local URL; file under private store).
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
  const abs = meshWritePath(`${iterationId}.${ext}`)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, Buffer.from(bytes))
  return `/meshes/${iterationId}.${ext}`
}

/** Delete a persisted asset (mesh, sliced 3MF, uploaded image, or imported base).
 *  http(s) → Vercel blob; local '/meshes/...' or '/uploads/...' → private store
 *  (+ legacy public/ path). Swallows "already gone" so orphan-sweep stays idempotent. */
export async function delMesh(meshUrl: string): Promise<void> {
  if (meshUrl.startsWith('http')) {
    await del(meshUrl, { token: env.BLOB_READ_WRITE_TOKEN })
    return
  }
  if (meshUrl.startsWith('/meshes/') || meshUrl.startsWith('/uploads/')) {
    // Delete primary path; also try legacy public/ for pre-migration files.
    const abs = await resolveLocalAssetPath(meshUrl)
    await unlink(abs).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e
    })
    // If primary was private store, also clear legacy public copy if present.
    if (meshUrl.startsWith('/meshes/') || meshUrl.startsWith('/uploads/')) {
      const { join } = await import('node:path')
      const legacy = join(process.cwd(), 'public', meshUrl.replace(/^\//, ''))
      if (legacy !== abs) {
        await unlink(legacy).catch(() => {})
      }
    }
  }
}
