/**
 * GET /api/slicer-health — proxies the slicer's /health so the browser can show
 * slicer availability proactively (the SliceButton disables itself when down).
 *
 * The `ok` flag lives in the JSON body, not the HTTP status, so the client reads
 * it uniformly; checkSlicerHealth never throws.
 */
import { auth } from '@/auth'
import { apiError } from '@/lib/http/api-error'
import { checkSlicerHealth } from '@/lib/slicer/client'

export const runtime = 'nodejs'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  // Surface only what the client needs (ok + reason). orca binary path and
  // profiles dir stay server-side — no need to expose internal FS layout.
  const health = await checkSlicerHealth()
  return Response.json({ ok: health.ok, error: health.error })
}
