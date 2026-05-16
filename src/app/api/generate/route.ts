import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { buildMessages } from '@/lib/prompt/build'
import { classifyIntent } from '@/lib/prompt/classify'
import { detectBaseMode } from '@/lib/prompt/base-detect'
import { getModel } from '@/lib/llm/model'
import { generateMesh, generateMeshFromImage } from '@/lib/meshy/client'
import { buildTrophyBase, type BaseSpec } from '@/lib/compose/trophy-base'
import { composeOnTop } from '@/lib/compose/stl-compose'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { generateText } from 'ai'
import { put } from '@vercel/blob'
import { and, asc, eq } from 'drizzle-orm'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 600 // allow up to 10min for image-to-3d preview+refine

const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
  imageUrl: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { projectId, message, imageUrl } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return new Response('Not found', { status: 404 })

  // Image input → always generative (image-to-3d). Skip classifier.
  if (imageUrl) {
    if (!process.env.MESHY_API_KEY) {
      return new Response('Image generation requires MESHY_API_KEY', { status: 503 })
    }

    const baseMode = detectBaseMode(message)

    // Resolve URL passed to Meshy. Two cases:
    //   1. Public URL (Vercel Blob in prod): pass through.
    //   2. Local path (/uploads/xxx.png in dev): Meshy can't reach localhost,
    //      so read the file from disk and inline it as a base64 data: URL.
    let resolvedImageUrl: string
    if (imageUrl.startsWith('http')) {
      resolvedImageUrl = imageUrl
    } else if (imageUrl.startsWith('/uploads/')) {
      const filePath = join(process.cwd(), 'public', imageUrl)
      const bytes = await readFile(filePath)
      const ext = imageUrl.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      resolvedImageUrl = `data:${mime};base64,${bytes.toString('base64')}`
    } else {
      return new Response(`Unrecognized imageUrl: ${imageUrl}`, { status: 400 })
    }

    const [iteration] = await db
      .insert(iterations)
      .values({
        projectId,
        userMessage: message,
        status: 'generating',
        strategy: 'generative',
        imageBlobUrl: imageUrl,
        baseMode,
      })
      .returning()

    const result = await generateMeshFromImage({
      imageUrl: resolvedImageUrl,
      apiKey: process.env.MESHY_API_KEY,
    })
    if (!result.ok) {
      await db.update(iterations)
        .set({ status: 'failed', error: result.error })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: result.error, iteration_id: iteration.id }, { status: 502 })
    }

    // Compose with trophy base if requested
    let finalStl: Uint8Array = result.stl
    if (baseMode === 'with_base') {
      const spec = inferBaseDimsFromMesh(result.stl)
      const baseStl = buildTrophyBase(spec)
      finalStl = composeOnTop({
        top: result.stl,
        base: baseStl,
        baseHeight: spec.height,
        scaleTopTo: spec.topDiameter * 0.85,
      })
    }

    // Persist final STL
    const meshUrl = await persistMesh(finalStl, session.user.id, projectId, iteration.id)

    await db.update(iterations)
      .set({ status: 'ready', meshBlobUrl: meshUrl })
      .where(eq(iterations.id, iteration.id))
    await db.update(projects)
      .set({ currentIterationId: iteration.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    return Response.json({
      strategy: 'generative',
      iteration_id: iteration.id,
      mesh_url: meshUrl,
      mesh_base64: null,
      meta: { ...result.meta, base_mode: baseMode },
    })
  }

  // No image → existing classifier-based flow
  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  let strategy: 'parametric' | 'generative' = await classifyIntent(message)
  if (strategy === 'generative' && !process.env.MESHY_API_KEY) strategy = 'parametric'

  const [iteration] = await db
    .insert(iterations)
    .values({ projectId, userMessage: message, status: 'generating', strategy })
    .returning()

  if (strategy === 'generative') {
    const result = await generateMesh({ prompt: message, apiKey: process.env.MESHY_API_KEY! })
    if (!result.ok) {
      await db.update(iterations)
        .set({ status: 'failed', error: result.error })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: result.error, iteration_id: iteration.id }, { status: 502 })
    }
    const meshUrl = await persistMesh(result.stl, session.user.id, projectId, iteration.id)

    await db.update(iterations)
      .set({ status: 'ready', meshBlobUrl: meshUrl })
      .where(eq(iterations.id, iteration.id))
    await db.update(projects)
      .set({ currentIterationId: iteration.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    return Response.json({
      strategy: 'generative',
      iteration_id: iteration.id,
      mesh_url: meshUrl,
      mesh_base64: null,
      meta: result.meta,
    })
  }

  // Parametric
  const { system, messages } = buildMessages({
    history: history
      .filter((h) => h.strategy === 'parametric')
      .map((h) => ({ userMessage: h.userMessage, jscadCode: h.jscadCode })),
    newMessage: message,
  })

  const { text } = await generateText({
    model: getModel(),
    system,
    messages,
    maxOutputTokens: 4096,
  })

  await db.update(iterations)
    .set({ jscadCode: text, status: 'ready' })
    .where(eq(iterations.id, iteration.id))
  await db.update(projects)
    .set({ currentIterationId: iteration.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId))

  return Response.json({
    strategy: 'parametric',
    iteration_id: iteration.id,
    jscad_code: text,
  })
}

/**
 * Save mesh STL bytes either to Vercel Blob (prod) or to public/meshes (dev).
 * Returns the URL the browser can fetch from.
 */
async function persistMesh(
  stl: Uint8Array,
  userId: string,
  projectId: string,
  iterationId: string,
): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${userId}/${projectId}/${iterationId}.stl`, Buffer.from(stl), {
      access: 'public',
      addRandomSuffix: false,
    })
    return blob.url
  }
  const dir = join(process.cwd(), 'public', 'meshes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${iterationId}.stl`), Buffer.from(stl))
  return `/meshes/${iterationId}.stl`
}

/**
 * Derive trophy base dimensions from the logo mesh bbox.
 * Heuristics:
 *  - topDiameter = max(bbox.x, bbox.y) * 1.2  (gives the logo some breathing room on the base)
 *  - bottomDiameter = topDiameter * 1.3        (stable taper)
 *  - height = max(20, bbox.z * 0.5)            (at least 20mm; otherwise 50% of logo height)
 */
function inferBaseDimsFromMesh(stl: Uint8Array): BaseSpec {
  const positions = parseBinarySTL(stl)
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const sizeZ = maxZ - minZ
  const topDiameter = Math.max(sizeX, sizeY) * 1.2
  const bottomDiameter = topDiameter * 1.3
  const height = Math.max(20, sizeZ * 0.5)
  return { topDiameter, bottomDiameter, height }
}
