/**
 * Unified /api/generate.
 *
 * Pipeline:
 *   1. Resolve the source image (fresh upload wins, else last image in history).
 *   2. Describe the image once if not cached (vision LLM).
 *   3. LLM parser converts the request into a structured Design.
 *   4. Single parametric generator produces an STL (JSCAD primitives, free)
 *      or delegates to Meshy for `freeform` shapes.
 *   5. Post-process orientation pipeline, persist, return.
 *
 * No detector ladder, no per-composer routing. One design, one generator.
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { describeImage } from '@/lib/prompt/describe-image'
import { parseDesign } from '@/lib/design/parse'
import { generateFromDesign, readImageAspectRatio } from '@/lib/design/generate'
import { sanitizeDesign } from '@/lib/design/sanitize'
import { tryQuickModify } from '@/lib/design/quick-modifier'
import { Design } from '@/lib/design/schema'
import type { PreviewBundle } from '@/lib/design/parse-import'
import type { SemanticFace } from '@/lib/import/types'
import { put } from '@vercel/blob'
import { serialize3mf } from '@/lib/3mf/serialize-3mf'
import { generateMesh, generateMeshFromImage, isMeshyConfigured } from '@/lib/meshy/client'
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
  /** Fresh .3mf upload URL or relative path — triggers the imported-mesh edit branch. */
  meshUrl: z.string().min(1).optional(),
  /** Client-captured 4-angle PNG previews (data URLs) for the first import request. */
  previewDataUrls: z.object({
    top: z.string(),
    front: z.string(),
    right: z.string(),
    iso: z.string(),
  }).optional(),
  /** Bypass the LLM parser. The generator builds straight from this Design
   * (still sanity-clamped). Useful for direct numeric overrides
   * ("sizeRatio EXACTLY 0.85") that natural-language iteration handles
   * poorly. */
  designOverride: Design.optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { projectId, message, imageUrl, meshUrl: freshMeshUrl, previewDataUrls: freshPreviews, designOverride } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return new Response('Not found', { status: 404 })

  // Resolve image: fresh upload wins; else most recent image in this project.
  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  let effectiveImageUrl: string | null = imageUrl ?? null
  let effectiveDescription: string | null = null
  if (effectiveImageUrl) {
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

  // Iteration row up front so we have an id even on failure.
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

  // Describe the image now if not cached.
  if (effectiveImageUrl && !effectiveDescription) {
    try {
      effectiveDescription = await describeImage(effectiveImageUrl)
      await db.update(iterations)
        .set({ imageDescription: effectiveDescription })
        .where(eq(iterations.id, iteration.id))
    } catch (err) {
      console.error('[generate] describeImage failed (continuing):', err)
    }
  }

  // Load logo image buffer up front — needed both for the aspect-ratio hint
  // passed to the LLM and for the geometry build.
  let logoImageBuffer: Buffer | null = null
  if (effectiveImageUrl) {
    try {
      if (effectiveImageUrl.startsWith('http')) {
        const r = await fetch(effectiveImageUrl)
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        logoImageBuffer = Buffer.from(await r.arrayBuffer())
      } else {
        logoImageBuffer = await readFile(join(process.cwd(), 'public', effectiveImageUrl))
      }
    } catch (err) {
      console.error('[generate] image fetch failed (continuing without logo):', err)
    }
  }
  let imageAspectRatio: number | null = null
  if (logoImageBuffer) {
    try {
      imageAspectRatio = await readImageAspectRatio(logoImageBuffer)
    } catch {
      // non-fatal
    }
  }

  // ── Base-mesh resolution (imported-mesh flow) ──────────────────────────────
  // Fresh upload wins; else look back in history for a cached imported design.
  let effectiveMeshUrl: string | null = freshMeshUrl ?? null
  let cachedFaces: SemanticFace[] | null = null
  let cachedPreviews: PreviewBundle | null = null

  if (!effectiveMeshUrl) {
    const lastWithMesh = [...history].reverse().find((h) => {
      const vr = h.validationReport as { kind?: string; baseMeshUrl?: string } | null
      return vr?.kind === 'imported' && vr.baseMeshUrl
    })
    if (lastWithMesh) {
      const vr = lastWithMesh.validationReport as { baseMeshUrl?: string; _faces?: unknown; _previews?: unknown } | null
      effectiveMeshUrl = vr?.baseMeshUrl ?? null
      cachedFaces = (vr?._faces ?? null) as SemanticFace[] | null
      cachedPreviews = (vr?._previews ?? null) as PreviewBundle | null
    }
  }

  let importContext: Parameters<typeof parseDesign>[0]['importContext'] | undefined
  if (effectiveMeshUrl) {
    try {
      const { loadBaseMeshFromUrl } = await import('@/lib/import/load-base-mesh')
      const { segmentFaces } = await import('@/lib/import/face-segment')

      const base = await loadBaseMeshFromUrl(effectiveMeshUrl)
      const faces = cachedFaces ?? segmentFaces(base)
      const previews = cachedPreviews ?? freshPreviews
      if (!previews) {
        await db.update(iterations)
          .set({ status: 'failed', error: 'previewDataUrls required for imported mesh' })
          .where(eq(iterations.id, iteration.id))
        return Response.json({
          error: 'Imported edit requires previewDataUrls (client must capture and send them with the first request)',
          iteration_id: iteration.id,
        }, { status: 400 })
      }
      importContext = {
        baseMeshUrl: effectiveMeshUrl,
        faces,
        previewDataUrls: previews,
        bboxMm: base.bbox.size as [number, number, number],
      }
    } catch (err) {
      const e = err as Error
      console.error('[generate] base mesh load/segment failed:', e.stack ?? e.message)
      await db.update(iterations)
        .set({ status: 'failed', error: `base mesh load failed: ${e.message}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({
        error: `Failed to load base mesh: ${e.message}`,
        iteration_id: iteration.id,
      }, { status: 500 })
    }
  }

  // LLM → structured Design. Pull the most recent successfully-built Design
  // from this project's history (stored in `validationReport` jsonb) so the
  // LLM can iterate on it instead of re-parsing from scratch.
  const lastReadyWithDesign = [...history]
    .reverse()
    .find((h) => h.status === 'ready' && h.validationReport)
  const previousDesign = (lastReadyWithDesign?.validationReport ?? null) as
    | Awaited<ReturnType<typeof parseDesign>>
    | null

  const allMessages = history.map((h) => h.userMessage).concat([message])
  let design: Design
  let designAdjustments: Array<{ field: string; from: number; to: number }> = []
  let designSource: 'llm' | 'override' | 'quick_modifier' = 'llm'
  try {
    let candidate: Awaited<ReturnType<typeof parseDesign>>
    if (designOverride) {
      candidate = designOverride
      designSource = 'override'
    } else {
      // Try deterministic pattern matching first — catches "logo maior",
      // "tira a alça", "buraco do lado", etc. without burning LLM tokens
      // or risking Haiku ignoring the modification.
      // Skip quick-modifier for imported flow — it doesn't understand the op schema.
      const quick = importContext ? null : tryQuickModify(message, previousDesign)
      if (quick) {
        candidate = quick
        designSource = 'quick_modifier'
        console.log('[generate] quick modifier matched:', message)
      } else {
        candidate = await parseDesign({
          messages: allMessages,
          imageDescription: effectiveDescription,
          imageAspectRatio,
          previousDesign,
          importContext,
        })
      }
    }
    // Sanity-clamp dimensions before building geometry (applies to both
    // LLM and user-overridden designs).
    const sane = sanitizeDesign(candidate)
    design = sane.design
    designAdjustments = sane.adjustments
    if (designAdjustments.length > 0) {
      console.log(`[generate] design clamped (${designSource}):`, designAdjustments)
    }
  } catch (err) {
    const e = err as Error
    console.error('[generate] parseDesign failed:', e.stack ?? e.message)
    await db.update(iterations)
      .set({ status: 'failed', error: `design parse failed: ${e.message}` })
      .where(eq(iterations.id, iteration.id))
    return Response.json({ error: e.message, iteration_id: iteration.id }, { status: 500 })
  }

  // Build geometry. Freeform → Meshy (organic/figurative shapes the parametric
  // engine can't make); every other kind → the synchronous parametric builder.
  let finalMeshBytes: Uint8Array
  let metaBbox: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  if (design.kind === 'freeform') {
    if (!isMeshyConfigured()) {
      await db.update(iterations)
        .set({ status: 'failed', error: 'Freeform generation not configured (MESHY_API_KEY missing)' })
        .where(eq(iterations.id, iteration.id))
      return Response.json({
        error: 'Freeform generation is not configured. Set MESHY_API_KEY or rephrase as a parametric shape.',
        iteration_id: iteration.id,
      }, { status: 503 })
    }
    const apiKey = process.env.MESHY_API_KEY as string
    const meshy = design.sourceImageUrl
      ? await generateMeshFromImage({ imageUrl: design.sourceImageUrl, apiKey })
      : await generateMesh({ prompt: design.prompt, apiKey })
    if (!meshy.ok) {
      await db.update(iterations)
        .set({ status: 'failed', error: `meshy failed: ${meshy.error}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: meshy.error, iteration_id: iteration.id }, { status: 502 })
    }
    finalMeshBytes = meshy.stl
  } else {
    let result
    try {
      result = await generateFromDesign(design, { logoImageBuffer })
    } catch (err) {
      const e = err as Error
      console.error('[generate] generator failed:', e.stack ?? e.message)
      await db.update(iterations)
        .set({ status: 'failed', error: `build failed: ${e.message}` })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: e.message, iteration_id: iteration.id }, { status: 500 })
    }
    // Parametric builders produce already-grounded geometry in the correct
    // orientation — no post-processing needed.
    finalMeshBytes = result.bodies.length > 1 ? serialize3mf(result.bodies) : result.stl
    metaBbox = result.meta.bboxMm
  }

  const meshUrl = await persistMesh(finalMeshBytes, session.user.id, projectId, iteration.id)

  // For imported designs, cache faces + previews so subsequent iterations
  // don't re-segment the mesh or require the client to re-send previews.
  const validationReport: Record<string, unknown> =
    design.kind === 'imported' && importContext
      ? { ...(design as object), _faces: importContext.faces, _previews: importContext.previewDataUrls }
      : (design as unknown as Record<string, unknown>)

  await db.update(iterations)
    .set({
      status: 'ready',
      meshBlobUrl: meshUrl,
      validationReport,
    })
    .where(eq(iterations.id, iteration.id))
  await db.update(projects)
    .set({ currentIterationId: iteration.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId))

  return Response.json({
    strategy: 'generative',
    iteration_id: iteration.id,
    mesh_url: meshUrl,
    mesh_base64: null,
    design,
    design_adjustments: designAdjustments,
    meta: {
      kind: design.kind,
      bbox_mm: metaBbox,
    },
  })
}

async function persistMesh(
  bytes: Uint8Array,
  userId: string,
  projectId: string,
  iterationId: string,
): Promise<string> {
  const is3mf = bytes[0] === 0x50 && bytes[1] === 0x4b
  const ext = is3mf ? '3mf' : 'stl'
  const contentType = is3mf ? 'application/octet-stream' : 'model/stl'
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${userId}/${projectId}/${iterationId}.${ext}`, Buffer.from(bytes), {
      access: 'public',
      addRandomSuffix: false,
      contentType,
    })
    return blob.url
  }
  const dir = join(process.cwd(), 'public', 'meshes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${iterationId}.${ext}`), Buffer.from(bytes))
  return `/meshes/${iterationId}.${ext}`
}
