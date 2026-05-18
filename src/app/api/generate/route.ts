/**
 * SINGLE-PATH /api/generate.
 *
 * Flow:
 *   1. Resolve image: fresh upload in this request wins; else most recent
 *      image in this project's history.
 *   2. If image has no description yet, describe it once (vision LLM, cached
 *      to the iteration row so we don't repay for it).
 *   3. Synthesize a prompt from description + chat history.
 *   4. Send to Meshy text-to-3D.
 *   5. Post-process + persist + return.
 *
 * NO branches into image-to-3D, no logo-extrude, no parametric JSCAD, no
 * classifier. Just one path: text-to-3D with a synthesized prompt. Anything
 * the user can describe gets sent to Meshy verbatim.
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { describeImage } from '@/lib/prompt/describe-image'
import { synthesizeIterationPrompt } from '@/lib/prompt/synthesize-iteration'
import { generateMesh } from '@/lib/meshy/client'
import { repairAndPrepareMesh } from '@/lib/compose/repair-mesh'
import { composeKeychain } from '@/lib/compose/keychain'
import { shouldUseKeychainComposer } from '@/lib/compose/detect-keychain'
import { composeCoaster } from '@/lib/compose/coaster'
import { shouldUseCoasterComposer } from '@/lib/compose/detect-coaster'
import { composeMedal } from '@/lib/compose/medal'
import { shouldUseMedalComposer } from '@/lib/compose/detect-medal'
import { composePingente } from '@/lib/compose/pingente'
import { shouldUsePingenteComposer } from '@/lib/compose/detect-pingente'
import { composeIma } from '@/lib/compose/ima'
import { shouldUseImaComposer } from '@/lib/compose/detect-ima'
import { composePlaquinha } from '@/lib/compose/plaquinha'
import { shouldUsePlaquinhaComposer } from '@/lib/compose/detect-plaquinha'
import { parseLogoSizeRatio } from '@/lib/compose/parse-size'
import { composeWithMeshyBase } from '@/lib/compose/with-meshy-base'
import { put } from '@vercel/blob'
import { and, asc, eq } from 'drizzle-orm'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 600

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

  if (!process.env.MESHY_API_KEY) {
    return new Response('MESHY_API_KEY is required', { status: 503 })
  }

  // Pull project history once: we need it for prompt context and to find the
  // last image + its cached description.
  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  // Image resolution: fresh upload in body wins; else fall back to the most
  // recent iteration with an image attached.
  let effectiveImageUrl: string | null = imageUrl ?? null
  let effectiveDescription: string | null = null
  if (effectiveImageUrl) {
    // Fresh upload — see if any prior iteration already described this URL,
    // saving a vision LLM call.
    const prior = history.find(
      (h) => h.imageBlobUrl === effectiveImageUrl && h.imageDescription,
    )
    effectiveDescription = prior?.imageDescription ?? null
  } else {
    const lastWithImg = [...history].reverse().find((h) => h.imageBlobUrl)
    if (lastWithImg) {
      effectiveImageUrl = lastWithImg.imageBlobUrl
      effectiveDescription = lastWithImg.imageDescription
    }
  }

  // Create iteration up front so we have an id for the response even on failure.
  const [iteration] = await db
    .insert(iterations)
    .values({
      projectId,
      userMessage: message,
      status: 'generating',
      strategy: 'generative',
      imageBlobUrl: effectiveImageUrl ?? undefined,
    })
    .returning()

  // ── Deterministic composer paths ──────────────────────────────────────────
  // When the user's message matches a known object type AND we have a source
  // image, bypass Meshy and call the corresponding composer. Meshy can't
  // reproduce specific brand logos; composers do that by extruding the
  // logo image directly.
  const composerKind:
    | 'keychain' | 'coaster' | 'medal' | 'pingente' | 'ima' | 'plaquinha' | null =
    effectiveImageUrl && shouldUsePlaquinhaComposer(message)
      ? 'plaquinha'
      : effectiveImageUrl && shouldUseImaComposer(message)
      ? 'ima'
      : effectiveImageUrl && shouldUsePingenteComposer(message)
      ? 'pingente'
      : effectiveImageUrl && shouldUseMedalComposer(message)
      ? 'medal'
      : effectiveImageUrl && shouldUseCoasterComposer(message)
      ? 'coaster'
      : effectiveImageUrl && shouldUseKeychainComposer(message)
      ? 'keychain'
      : null

  if (composerKind) {
    let imageBuffer: Buffer
    try {
      if (effectiveImageUrl!.startsWith('http')) {
        const r = await fetch(effectiveImageUrl!)
        if (!r.ok) throw new Error(`Image fetch ${r.status}`)
        imageBuffer = Buffer.from(await r.arrayBuffer())
      } else {
        imageBuffer = await readFile(join(process.cwd(), 'public', effectiveImageUrl!))
      }
    } catch (err) {
      await db.update(iterations)
        .set({ status: 'failed', error: `Could not read source image: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: 'source image unreadable', iteration_id: iteration.id }, { status: 502 })
    }

    let resultStl: Uint8Array
    let resultBboxMm: { x: number; y: number; z: number }
    let resultLogoBboxMm: { x: number; y: number; z: number }
    try {
      const logoSizeRatio = parseLogoSizeRatio(message)
      if (composerKind === 'keychain') {
        const r = await composeKeychain({ imageBuffer, logoSizeRatio })
        resultStl = r.stl
        resultBboxMm = r.meta.bboxMm
        resultLogoBboxMm = r.meta.logoBboxMm
      } else if (composerKind === 'coaster') {
        const r = await composeCoaster({ imageBuffer, logoSizeRatio })
        resultStl = r.stl
        resultBboxMm = r.meta.bboxMm
        resultLogoBboxMm = r.meta.logoBboxMm
      } else if (composerKind === 'medal') {
        const r = await composeMedal({ imageBuffer, logoSizeRatio })
        resultStl = r.stl
        resultBboxMm = r.meta.bboxMm
        resultLogoBboxMm = { x: 0, y: 0, z: 0 }
      } else if (composerKind === 'pingente') {
        const r = await composePingente({ imageBuffer, logoSizeRatio })
        resultStl = r.stl
        resultBboxMm = r.meta.bboxMm
        resultLogoBboxMm = { x: 0, y: 0, z: 0 }
      } else if (composerKind === 'ima') {
        const r = await composeIma({ imageBuffer, logoSizeRatio })
        resultStl = r.stl
        resultBboxMm = r.meta.bboxMm
        resultLogoBboxMm = { x: 0, y: 0, z: 0 }
      } else {
        const r = await composePlaquinha({ imageBuffer, logoSizeRatio })
        resultStl = r.stl
        resultBboxMm = r.meta.bboxMm
        resultLogoBboxMm = { x: 0, y: 0, z: 0 }
      }
    } catch (err) {
      const e = err as Error
      console.error(`[${composerKind}] failed:`, e.stack ?? e.message)
      await db.update(iterations)
        .set({ status: 'failed', error: `${composerKind} compose failed: ${e.message}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: e.message, iteration_id: iteration.id }, { status: 500 })
    }

    const meshUrl = await persistMesh(resultStl, session.user.id, projectId, iteration.id)
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
        source:
          composerKind === 'keychain'
            ? 'keychain_compose'
            : composerKind === 'coaster'
            ? 'coaster_compose'
            : composerKind === 'medal'
            ? 'medal_compose'
            : composerKind === 'pingente'
            ? 'pingente_compose'
            : composerKind === 'ima'
            ? 'ima_compose'
            : 'plaquinha_compose',
        bbox_mm: resultBboxMm,
        logo_bbox_mm: resultLogoBboxMm,
      },
    })
  }
  // ── end composer paths ────────────────────────────────────────────────────

  // ── Universal Meshy + logo composer ───────────────────────────────────────
  // If we have an image AND a text message (anything not matched by the
  // dedicated composers above), let Meshy generate the SHAPE from the text
  // and slap the user's actual logo on the front face. This is how "trofeu",
  // "estatueta", "porta-canetas", any decorative form, gets the real logo
  // without Meshy improvising a fake version of it.
  if (effectiveImageUrl) {
    let imageBuffer: Buffer
    try {
      if (effectiveImageUrl.startsWith('http')) {
        const r = await fetch(effectiveImageUrl)
        if (!r.ok) throw new Error(`Image fetch ${r.status}`)
        imageBuffer = Buffer.from(await r.arrayBuffer())
      } else {
        imageBuffer = await readFile(join(process.cwd(), 'public', effectiveImageUrl))
      }
    } catch (err) {
      await db.update(iterations)
        .set({ status: 'failed', error: `Could not read source image: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: 'source image unreadable', iteration_id: iteration.id }, { status: 502 })
    }

    let result
    try {
      result = await composeWithMeshyBase({
        shapePrompt: message, // raw user text — let Meshy interpret freely
        meshyApiKey: process.env.MESHY_API_KEY,
        logoImageBuffer: imageBuffer,
      })
    } catch (err) {
      const e = err as Error
      console.error('[meshy-with-logo] failed:', e.stack ?? e.message)
      await db.update(iterations)
        .set({ status: 'failed', error: `Compose failed: ${e.message}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: e.message, iteration_id: iteration.id }, { status: 500 })
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
      meta: {
        source: 'meshy_with_logo',
        bbox_mm: result.meta.bboxMm,
        meshy_took_ms: result.meta.meshyTookMs,
        meshy_triangles: result.meta.meshyTriangleCount,
        logo_triangles: result.meta.logoTriangleCount,
        logo_strategy: result.meta.logoStrategy,
      },
    })
  }
  // ── end universal composer ────────────────────────────────────────────────

  // Describe the image now if we don't already have a cached description.
  if (effectiveImageUrl && !effectiveDescription) {
    try {
      effectiveDescription = await describeImage(effectiveImageUrl)
    } catch (err) {
      console.error('[generate] describeImage failed (continuing without description):', err)
    }
  }
  if (effectiveDescription) {
    await db.update(iterations)
      .set({ imageDescription: effectiveDescription })
      .where(eq(iterations.id, iteration.id))
  }

  // Build Meshy prompt. If we have a logo description, synth combines it with
  // the user's chat history; otherwise we just pass the message through raw.
  const allMessages = history.map((h) => h.userMessage).concat([message])
  let prompt: string
  if (effectiveDescription) {
    try {
      prompt = await synthesizeIterationPrompt({
        imageDescription: effectiveDescription,
        messages: allMessages,
      })
    } catch (err) {
      console.error('[generate] synthesize failed, using raw message:', err)
      prompt = message
    }
  } else {
    prompt = message
  }

  // Off to Meshy.
  const result = await generateMesh({ prompt, apiKey: process.env.MESHY_API_KEY })
  if (!result.ok) {
    await db.update(iterations)
      .set({ status: 'failed', error: result.error })
      .where(eq(iterations.id, iteration.id))
    return Response.json({ error: result.error, iteration_id: iteration.id }, { status: 502 })
  }

  // Light post-processing: merge near-duplicate verts (slicer manifold fix) and
  // scale to printable size. No mirror, no Y-up→Z-up — Meshy text-to-3D's
  // output already plays nicely with our viewer/slicer convention.
  const prepared = repairAndPrepareMesh(result.stl, {
    targetMaxDim: 60,
    mirrorX: false,
    yUpToZUp: true, // Meshy text-to-3D outputs Y-up; viewer expects Z-up
  })
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
    meta: {
      task_id: result.meta.task_id,
      took_ms: result.meta.took_ms,
      source: effectiveImageUrl ? 'image+text' : 'text',
      synthesized_prompt: prompt,
    },
  })
}

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
