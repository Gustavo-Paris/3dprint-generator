import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { sliceStl, SlicerError } from '@/lib/slicer/client'
import { assertSliceable } from '@/lib/slice/preconditions'
import { apiError } from '@/lib/http/api-error'
import { createRequestLogger } from '@/lib/log'
import { put } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
// Heavy meshes (700k+ tris) can take ~2 min to slice; keep the route alive
// longer than the slicer client's 280s abort.
export const maxDuration = 300

const Body = z.object({
  iterationId: z.string().uuid(),
})

export async function POST(req: Request) {
  const log = createRequestLogger('slice')
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')
  const { iterationId } = parsed.data

  const [row] = await db
    .select({ iteration: iterations, project: projects })
    .from(iterations)
    .innerJoin(projects, eq(iterations.projectId, projects.id))
    .where(and(eq(iterations.id, iterationId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!row) return apiError(404, 'not_found', 'Iteração não encontrada.')

  // Only ready/sliced rows are sliceable — never a generating/failed one.
  const gate = assertSliceable(row.iteration.status)
  if (!gate.ok) return apiError(gate.status, 'not_sliceable', 'Esta iteração ainda não pode ser fatiada.')

  if (!row.iteration.meshBlobUrl) {
    return apiError(409, 'no_mesh', 'Esta iteração não tem malha para fatiar.')
  }

  // Slice the SERVER-persisted mesh, not bytes the client sent. Blob URLs are
  // absolute (http); local-dev meshes are relative under public/.
  let meshBytes: Buffer
  try {
    const url = row.iteration.meshBlobUrl
    if (url.startsWith('http')) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch ${res.status}`)
      meshBytes = Buffer.from(await res.arrayBuffer())
    } else {
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      meshBytes = await readFile(join(process.cwd(), 'public', url))
    }
  } catch (e) {
    log.error('persisted mesh load failed', e, { iterationId })
    return apiError(502, 'mesh_load_failed', 'Não foi possível carregar a malha para o fatiamento.')
  }

  // Flatten multi-body meshes to a single-material STL for slicing. A multi-body
  // emboss arrives as a 3MF (zip): OrcaSlicer can't load it under an .stl name,
  // and its per-body extruder mapping fights a single-filament profile. Slicing
  // is single-material anyway (multi-colour is the separate Download-3MF path),
  // so flatten all bodies into one STL the slicer loads cleanly. (Needs the
  // slicer's raised body limit — a 700k-tri STL is tens of MB.)
  if (meshBytes[0] === 0x50 && meshBytes[1] === 0x4b) {
    try {
      const { loadBaseMeshFromBytes } = await import('@/lib/import/load-base-mesh')
      const { serializeBinarySTL } = await import('@/lib/stl/serialize')
      const mesh = await loadBaseMeshFromBytes(new Uint8Array(meshBytes))
      meshBytes = Buffer.from(serializeBinarySTL(Array.from(mesh.positions)))
    } catch (e) {
      log.error('3mf->stl convert failed', e, { iterationId })
      return apiError(422, 'mesh_convert_failed', 'Não foi possível preparar a malha para o fatiamento.')
    }
  }

  let result
  try {
    result = await sliceStl(meshBytes)
  } catch (e) {
    log.error('slice failed', e, { iterationId })
    if (e instanceof SlicerError) {
      // slicer-side failure → 502; offline/timeout → 503 (slicer unavailable).
      return e.kind === 'slicer'
        ? apiError(502, 'slicer_failed', 'O fatiador falhou ao processar a malha.')
        : apiError(503, 'slicer_unavailable', 'O fatiador está indisponível no momento.')
    }
    return apiError(502, 'slicer_failed', 'O fatiador falhou ao processar a malha.')
  }

  // Upload 3MF to Blob if configured; otherwise return inline base64 so the
  // client can save it without external storage (handy for local dev).
  const filename = `${session.user.id}/${row.project.id}/${iterationId}.3mf`
  let slicedUrl: string | null = null
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(filename, Buffer.from(result.bytes), {
      access: 'public',
      addRandomSuffix: false,
    })
    slicedUrl = blob.url
  }

  await db
    .update(iterations)
    .set({
      slicedBlobUrl: slicedUrl,
      slicedMeta: result.meta,
      slicedAt: new Date(),
      status: 'sliced',
    })
    .where(eq(iterations.id, iterationId))

  return Response.json({
    url: slicedUrl,
    inline_base64: slicedUrl ? null : Buffer.from(result.bytes).toString('base64'),
    meta: result.meta,
  })
}
