/**
 * GET /meshes/[file] — serve runtime-generated meshes in production builds.
 *
 * Without BLOB_READ_WRITE_TOKEN, persistMesh writes to public/meshes/ and
 * stores the URL '/meshes/<iterationId>.<ext>'. Under `next start`, public/
 * is frozen at build time, so files created after the build 404 on the static
 * layer — those requests fall through to this handler, which reads the file
 * from disk. Files that DID exist at build time (and all files in dev) are
 * served by the static layer first; this handler only sees the leftovers.
 * Same bytes either way, so the split is invisible to clients.
 *
 * Authorization: the mesh belongs to a user. We require a session and an
 * iteration row whose meshBlobUrl/slicedBlobUrl equals '/meshes/<name>' in a
 * project owned by the session user. No match → 404 (never 403, to avoid
 * leaking existence).
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { apiError } from '@/lib/http/api-error'
import { and, eq, or } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const runtime = 'nodejs'

// iterationId (uuid) + known mesh extension. Anything else — traversal
// sequences, encoded slashes, other extensions — is rejected BEFORE any
// path is built.
const NAME_RE = /^[0-9a-f-]{36}\.(stl|3mf)$/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params
  // basename() strips any directory components that survive decoding; the
  // regex then only accepts '<uuid>.<stl|3mf>', so no traversal can pass.
  const name = basename(file)
  if (name !== file || !NAME_RE.test(name)) {
    return apiError(404, 'not_found', 'Arquivo não encontrado.')
  }

  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  const url = `/meshes/${name}`
  const [row] = await db
    .select({ id: iterations.id })
    .from(iterations)
    .innerJoin(projects, eq(iterations.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, session.user.id),
        or(eq(iterations.meshBlobUrl, url), eq(iterations.slicedBlobUrl, url)),
      ),
    )
    .limit(1)
  if (!row) return apiError(404, 'not_found', 'Arquivo não encontrado.')

  let bytes: Buffer
  try {
    bytes = await readFile(join(process.cwd(), 'public', 'meshes', name))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return apiError(404, 'not_found', 'Arquivo não encontrado.')
    }
    throw e
  }

  const contentType = name.toLowerCase().endsWith('.3mf')
    ? 'application/octet-stream'
    : 'model/stl'
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': contentType,
      // iterationId is immutable — a given iteration's mesh never changes.
      // 'private': the response is auth-gated (session + ownership), so only
      // the end user's browser cache may store it — never a shared/CDN cache,
      // which would re-serve the bytes without re-running the 401/404 gates.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
