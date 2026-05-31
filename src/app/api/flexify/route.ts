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
import { flexify } from '@/lib/flexify'
import { put } from '@vercel/blob'
import { and, asc, desc, eq } from 'drizzle-orm'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/** Read raw 3MF bytes from an absolute URL or a project-local `/...` path. */
async function readMeshBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const rel = url.startsWith('/') ? url.slice(1) : url
  return new Uint8Array(await readFile(join(process.cwd(), 'public', rel)))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { projectId, meshUrl } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return new Response('Not found', { status: 404 })

  // Resolve source mesh: explicit URL wins; else the project's latest ready mesh.
  let sourceMeshUrl = meshUrl ?? null
  if (!sourceMeshUrl) {
    const history = await db
      .select()
      .from(iterations)
      .where(eq(iterations.projectId, projectId))
      .orderBy(desc(iterations.createdAt))
    const lastReady = history.find(
      (h) => (h.status === 'ready' || h.status === 'sliced') && h.meshBlobUrl,
    )
    sourceMeshUrl = lastReady?.meshBlobUrl ?? null
  }
  if (!sourceMeshUrl) {
    return new Response('No source mesh: generate or upload a mesh first', { status: 400 })
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
    const meshBytes = await readMeshBytes(sourceMeshUrl)
    if (meshBytes.byteLength > MAX_BYTES) {
      throw new Error(`source mesh exceeds ${MAX_BYTES / 1024 / 1024}MB`)
    }
    const rocktopusBytes = new Uint8Array(await readFile(join(process.cwd(), ROCKTOPUS_REF)))
    const result = await flexify(meshBytes, rocktopusBytes)
    bytes = result.bytes
    report = result.report
  } catch (err) {
    const e = err as Error
    console.error('[flexify] failed:', e.stack ?? e.message)
    await db.update(iterations)
      .set({ status: 'failed', error: `flexify failed: ${e.message}` })
      .where(eq(iterations.id, iteration.id))
    return Response.json({ error: e.message, iteration_id: iteration.id }, { status: 500 })
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
  if (process.env.BLOB_READ_WRITE_TOKEN) {
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
