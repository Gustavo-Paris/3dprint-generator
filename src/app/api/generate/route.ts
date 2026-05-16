import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { buildMessages } from '@/lib/prompt/build'
import { classifyIntent } from '@/lib/prompt/classify'
import { detectBaseMode } from '@/lib/prompt/base-detect'
import { describeImage } from '@/lib/prompt/describe-image'
import { synthesizeIterationPrompt } from '@/lib/prompt/synthesize-iteration'
import { getModel } from '@/lib/llm/model'
import { generateMesh, generateMeshFromImage } from '@/lib/meshy/client'
import { buildTrophyBase, type BaseSpec } from '@/lib/compose/trophy-base'
import { composeOnTop } from '@/lib/compose/stl-compose'
import { repairAndPrepareMesh } from '@/lib/compose/repair-mesh'
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

    // Kick off image description in parallel with Meshy — we'll need it for
    // any future text-only iterations on this image.
    const descriptionPromise = describeImage(imageUrl).catch((err) => {
      console.error('describeImage failed:', err)
      return null
    })

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

    // Post-process Meshy output: merge duplicate verts (fix non-manifold edges
    // the slicer rejects), un-mirror X, and scale to a printable size.
    const preparedMesh = repairAndPrepareMesh(result.stl, {
      targetMaxDim: 60,
      mirrorX: true,
    })

    // Compose with trophy base if requested
    let finalStl: Uint8Array = preparedMesh
    if (baseMode === 'with_base') {
      const spec = inferBaseDimsFromMesh(preparedMesh)
      const baseStl = buildTrophyBase(spec)
      finalStl = composeOnTop({
        top: preparedMesh,
        base: baseStl,
        baseHeight: spec.height,
        scaleTopTo: spec.topDiameter * 0.85,
      })
    }

    // Persist final STL
    const meshUrl = await persistMesh(finalStl, session.user.id, projectId, iteration.id)
    const imageDescription = await descriptionPromise

    await db.update(iterations)
      .set({ status: 'ready', meshBlobUrl: meshUrl, imageDescription })
      .where(eq(iterations.id, iteration.id))
    await db.update(projects)
      .set({ currentIterationId: iteration.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    return Response.json({
      strategy: 'generative',
      iteration_id: iteration.id,
      mesh_url: meshUrl,
      mesh_base64: null,
      meta: { ...result.meta, base_mode: baseMode, source: 'image' },
    })
  }

  // No image attached on this message → either continue the existing classifier
  // flow, OR (if the project has a prior image-based generation) switch to
  // text-to-3D iteration mode using the synthesized description + history.
  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  // Find the most recent iteration that has an image_description. That's the
  // anchor for any iterations we route via text-to-3D.
  const lastImageIteration = [...history].reverse().find(
    (h) => h.imageBlobUrl && h.imageDescription && h.status === 'ready',
  )

  if (lastImageIteration && process.env.MESHY_API_KEY) {
    // Iteration on a prior image-based generation. Synthesize a rich prompt
    // from the image description + all prior user messages in this project +
    // the new message, then send to Meshy text-to-3D.
    const allMessages = history.map((h) => h.userMessage).concat([message])
    const synthesizedPrompt = await synthesizeIterationPrompt({
      imageDescription: lastImageIteration.imageDescription!,
      messages: allMessages,
    })
    const baseMode = detectBaseMode(message) // re-detect from latest message

    const [iteration] = await db
      .insert(iterations)
      .values({
        projectId,
        userMessage: message,
        status: 'generating',
        strategy: 'generative',
        baseMode,
        // Carry the image description forward so subsequent iterations keep
        // anchoring to the original image.
        imageDescription: lastImageIteration.imageDescription,
      })
      .returning()

    const result = await generateMesh({ prompt: synthesizedPrompt, apiKey: process.env.MESHY_API_KEY })
    if (!result.ok) {
      await db.update(iterations)
        .set({ status: 'failed', error: result.error })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: result.error, iteration_id: iteration.id }, { status: 502 })
    }

    const preparedMesh = repairAndPrepareMesh(result.stl, { targetMaxDim: 60, mirrorX: false })
    let finalStl: Uint8Array = preparedMesh
    if (baseMode === 'with_base') {
      const spec = inferBaseDimsFromMesh(preparedMesh)
      const baseStl = buildTrophyBase(spec)
      finalStl = composeOnTop({
        top: preparedMesh,
        base: baseStl,
        baseHeight: spec.height,
        scaleTopTo: spec.topDiameter * 0.85,
      })
    }
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
      meta: {
        ...result.meta,
        base_mode: baseMode,
        source: 'iteration',
        synthesized_prompt: synthesizedPrompt,
      },
    })
  }

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
    // Post-process: scale to printable size + merge dup verts. Text-to-3d refine
    // is usually manifold but the scale is normalized — always needs scaling up.
    // No mirror needed (no image asymmetry to flip).
    const prepared = repairAndPrepareMesh(result.stl, { targetMaxDim: 60, mirrorX: false })
    const meshUrl = await persistMesh(prepared, session.user.id, projectId, iteration.id)

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
