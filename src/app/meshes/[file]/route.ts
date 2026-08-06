/**
 * GET /meshes/[file] — sole local path for mesh bytes (auth + optional gzip).
 *
 * Without BLOB_READ_WRITE_TOKEN, persistMesh writes to the private mesh store
 * (MESH_STORAGE_DIR / `.data/meshes`), never under public/, so Next static
 * cannot bypass this handler. Legacy files in public/meshes/ are still readable
 * via resolveLocalAssetPath fallback.
 *
 * Authorization: session + iteration row owned by the user. No match → 404.
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { apiError } from '@/lib/http/api-error'
import { resolveLocalAssetPath } from '@/lib/storage/local-asset'
import { and, eq, or } from 'drizzle-orm'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const gzipAsync = promisify(gzip)

export const runtime = 'nodejs'

/** Gzip payloads larger than this (rm-012). Small files stay raw. */
const GZIP_MIN_BYTES = 2048

// iterationId (uuid) + known mesh extension. Anything else — traversal
// sequences, encoded slashes, other extensions — is rejected BEFORE any
// path is built.
const NAME_RE = /^[0-9a-f-]{36}\.(stl|3mf)$/i

export async function GET(
  req: Request,
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
    bytes = await readFile(await resolveLocalAssetPath(url))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return apiError(404, 'not_found', 'Arquivo não encontrado.')
    }
    throw e
  }

  const contentType = name.toLowerCase().endsWith('.3mf')
    ? 'application/octet-stream'
    : 'model/stl'

  const headers: Record<string, string> = {
    'content-type': contentType,
    // iterationId is immutable — a given iteration's mesh never changes.
    // 'private': the response is auth-gated (session + ownership), so only
    // the end user's browser cache may store it — never a shared/CDN cache,
    // which would re-serve the bytes without re-running the 401/404 gates.
    'cache-control': 'private, max-age=31536000, immutable',
  }

  // Optional gzip for large meshes (rm-012). Browsers send Accept-Encoding;
  // fetch() in same-origin typically decompresses automatically.
  const accept = req.headers.get('accept-encoding') ?? ''
  if (accept.includes('gzip') && bytes.byteLength >= GZIP_MIN_BYTES) {
    const gz = await gzipAsync(bytes)
    headers['content-encoding'] = 'gzip'
    headers['vary'] = 'Accept-Encoding'
    return new Response(new Uint8Array(gz), { headers })
  }

  return new Response(new Uint8Array(bytes), { headers })
}
