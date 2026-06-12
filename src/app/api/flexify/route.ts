/**
 * POST /api/flexify — turn an existing mesh into an articulated, print-in-place
 * toy.
 *
 * Pipeline:
 *   1. Resolve the source mesh bytes (a prior iteration's mesh, or any 3MF URL).
 *   2. Load the bundled Rocktopus reference flexi (public/refs/).
 *   3. flexify(meshBytes, rocktopusBytes) → multi-body articulated 3MF.
 *   4. Persist + create a 'ready' iteration the viewer can render.
 *
 * This is the web entry point for the previously CLI-only flexify pipeline. It
 * works on ANY 3MF (Meshy freeform output, an upload, or a previous parametric
 * build) — it does NOT require Meshy credits, since the reference is bundled.
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { env } from '@/env'
import { flexify } from '@/lib/flexify'
import { apiError } from '@/lib/http/api-error'
import { createRequestLogger } from '@/lib/log'
import { put } from '@vercel/blob'
import { and, desc, eq } from 'drizzle-orm'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 600

const ROCKTOPUS_REF = 'public/refs/rocktopus-reference.3mf'
const MAX_BYTES = 50 * 1024 * 1024

const Body = z.object({
  projectId: z.string().uuid(),
  /** Source mesh to articulate. When omitted, the project's latest ready mesh is used. */
  meshUrl: z.string().min(1).optional(),
})

/**
 * Read raw 3MF bytes from a server-issued mesh URL.
 *
 * SECURITY: callers MUST have already verified `url` is one this server issued
 * (i.e. a `meshBlobUrl` from an iteration owned by the requesting user — see the
 * ownMeshUrls membership check in POST). That check is the primary defense
 * against SSRF (attacker-chosen fetch target) and path traversal. The realpath
 * containment check below is belt-and-suspenders for the local-file branch.
 */
async function readMeshBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // URL is DB-verified server-issued (Blob public URL we wrote); no redirects.
    const res = await fetch(url, { redirect: 'manual' })
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`)
    // Bound memory BEFORE buffering: reject by Content-Length when present, then
    // enforce the cap while streaming so a missing/lying header can't defeat it.
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new Error('source mesh exceeds size limit')
    }
    if (!res.body) return new Uint8Array(await res.arrayBuffer())
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength
      if (total > MAX_BYTES) throw new Error('source mesh exceeds size limit')
      chunks.push(chunk)
    }
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.byteLength }
    return out
  }
  const publicDir = join(process.cwd(), 'public')
  const rel = url.startsWith('/') ? url.slice(1) : url
  const candidate = join(publicDir, rel)
  // Defense-in-depth: ensure the resolved path stays inside public/.
  const real = await realpath(candidate)
  if (real !== publicDir && !real.startsWith(publicDir + sep)) {
    throw new Error('resolved mesh path escapes the public directory')
  }
  // Bound memory BEFORE reading: stat-then-read so the cap actually applies.
  const info = await stat(real)
  if (info.size > MAX_BYTES) throw new Error('source mesh exceeds size limit')
  return new Uint8Array(await readFile(real))
}

export async function POST(req: Request) {
  const log = createRequestLogger('flexify')
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')
  const { projectId, meshUrl } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return apiError(404, 'not_found', 'Projeto não encontrado.')

  // Resolve source mesh ONLY from this project's own iterations, so the URL is
  // always one the server itself issued. This is the primary defense against
  // SSRF (attacker-chosen fetch target) and path traversal via a crafted
  // meshUrl — the project is already confirmed owned by session.user.id above.
  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(desc(iterations.createdAt))
  const ownMeshUrls = new Set(
    history.flatMap((h) => (h.meshBlobUrl ? [h.meshBlobUrl] : [])),
  )

  let sourceMeshUrl: string | null
  if (meshUrl) {
    if (!ownMeshUrls.has(meshUrl)) {
      // Reject any URL we didn't issue for this project — closes SSRF / traversal.
      return apiError(403, 'forbidden_mesh', 'A malha não pertence a este projeto.')
    }
    sourceMeshUrl = meshUrl
  } else {
    const lastReady = history.find(
      (h) => (h.status === 'ready' || h.status === 'sliced') && h.meshBlobUrl,
    )
    sourceMeshUrl = lastReady?.meshBlobUrl ?? null
  }
  if (!sourceMeshUrl) {
    return apiError(400, 'no_source_mesh', 'Gere ou envie uma malha antes de articular.')
  }

  const [iteration] = await db
    .insert(iterations)
    .values({
      projectId,
      userMessage: 'Make it flexi (articulated)',
      status: 'generating',
      strategy: 'generative',
    })
    .returning()

  let bytes: Uint8Array
  let report
  try {
    // readMeshBytes enforces MAX_BYTES before buffering (stat / Content-Length + stream cap).
    const meshBytes = await readMeshBytes(sourceMeshUrl)
    const rocktopusBytes = new Uint8Array(await readFile(join(process.cwd(), ROCKTOPUS_REF)))
    const result = await flexify(meshBytes, rocktopusBytes)
    bytes = result.bytes
    report = result.report
  } catch (err) {
    // Detail stays server-side (log + DB row); the client gets a generic message.
    log.error('flexify failed', err, { projectId, iterationId: iteration.id })
    await db.update(iterations)
      .set({ status: 'failed', error: `flexify failed: ${(err as Error).message}` })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'flexify_failed', 'Falha ao processar a malha.', { iteration_id: iteration.id })
  }

  const meshUrlOut = await persistMesh(bytes, session.user.id, projectId, iteration.id)

  await db.update(iterations)
    .set({
      status: 'ready',
      meshBlobUrl: meshUrlOut,
      validationReport: { kind: 'flexified', ...report },
    })
    .where(eq(iterations.id, iteration.id))
  await db.update(projects)
    .set({ currentIterationId: iteration.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId))

  return Response.json({
    strategy: 'generative',
    iteration_id: iteration.id,
    mesh_url: meshUrlOut,
    mesh_base64: null,
    report,
  })
}

async function persistMesh(
  bytes: Uint8Array,
  userId: string,
  projectId: string,
  iterationId: string,
): Promise<string> {
  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${userId}/${projectId}/${iterationId}.3mf`, Buffer.from(bytes), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
    })
    return blob.url
  }
  const dir = join(process.cwd(), 'public', 'meshes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${iterationId}.3mf`), Buffer.from(bytes))
  return `/meshes/${iterationId}.3mf`
}
