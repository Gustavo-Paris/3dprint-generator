/**
 * GET /uploads/[file] — serve runtime-uploaded files in production builds.
 *
 * Same production gap as /meshes/[file]: without BLOB_READ_WRITE_TOKEN,
 * /api/upload writes to public/uploads/ and returns '/uploads/<uuid>.<ext>',
 * but `next start` freezes public/ at build time, so runtime uploads 404 on
 * the static layer and fall through to this handler.
 *
 * Authorization: uploads are not tied to a DB row at upload time (they only
 * become iterations after a generate), so ownership cannot be checked here.
 * We require a session and an unguessable uuid-v4 name; non-matching names
 * 404 before any path is built.
 */
import { auth } from '@/auth'
import { apiError } from '@/lib/http/api-error'
import { resolveLocalAssetPath } from '@/lib/storage/local-asset'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export const runtime = 'nodejs'

const NAME_RE = /^[0-9a-f-]{36}\.(3mf|png|jpg|webp)$/i

const CONTENT_TYPES: Record<string, string> = {
  '3mf': 'application/octet-stream',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params
  const name = basename(file)
  if (name !== file || !NAME_RE.test(name)) {
    return apiError(404, 'not_found', 'Arquivo não encontrado.')
  }

  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  let bytes: Buffer
  try {
    bytes = await readFile(await resolveLocalAssetPath(`/uploads/${name}`))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return apiError(404, 'not_found', 'Arquivo não encontrado.')
    }
    throw e
  }

  const ext = name.toLowerCase().split('.').pop()!
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      // Upload ids are immutable uuids; auth-gated, so private cache only.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
