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
import { env } from '@/env'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { designKindToStrategy } from '@/db/strategy'
import { reapStuckIterations } from '@/lib/db/reap-stuck-iterations'
import { stripCacheKeys } from '@/lib/design/strip-cache-keys'
import { describeImage } from '@/lib/prompt/describe-image'
import { parseDesign } from '@/lib/design/parse'
import { generateFromDesign, readImageAspectRatio } from '@/lib/design/generate'
import { sanitizeDesign } from '@/lib/design/sanitize'
import { tryQuickModify } from '@/lib/design/quick-modifier'
import type { Design } from '@/lib/design/schema'
import { Body } from './body-schema'
import type { PreviewBundle } from '@/lib/design/parse-import'
import type { SemanticFace } from '@/lib/import/types'
import { put } from '@vercel/blob'
import { serialize3mf } from '@/lib/3mf/serialize-3mf'
import { generateMesh, generateMeshFromImage, isMeshyConfigured } from '@/lib/meshy/client'
import { apiError } from '@/lib/http/api-error'
import { assertUrlIsPublic } from '@/lib/http/is-public-url'
import { isOwnMeshUrl } from '@/lib/http/owns-mesh-url'
import { createRequestLogger } from '@/lib/log'
import { and, asc, eq } from 'drizzle-orm'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

export const runtime = 'nodejs'
export const maxDuration = 600

export async function POST(req: Request) {
  const log = createRequestLogger('generate')
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  // Best-effort reaper: clear iterations stuck in 'generating' (crashed route or
  // unguarded tail throw). Non-fatal — never block a new generate on it. A cron
  // job can call reapStuckIterations() directly too.
  try { await reapStuckIterations(db) } catch (e) { log.error('reaper failed', e) }

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')
  const { projectId, message, imageUrl, meshUrl: freshMeshUrl, previewDataUrls: freshPreviews, designOverride, logoPlacement } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return apiError(404, 'not_found', 'Projeto não encontrado.')

  // SSRF gate for a client-supplied external image URL (resolves DNS + blocks
  // private/loopback/link-local/metadata). Up front so we reject before any DB write.
  if (imageUrl && imageUrl.startsWith('http') && !(await assertUrlIsPublic(imageUrl))) {
    return apiError(400, 'invalid_image_url', 'URL de imagem não permitida.')
  }

  // Resolve image: fresh upload wins; else most recent image in this project.
  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  // Ownership gate for a client-supplied meshUrl: must be a URL THIS server
  // issued for THIS user (a prior iteration mesh, or a fresh upload under the
  // caller's namespace). Closes SSRF + cross-user access via a crafted meshUrl.
  const ownMeshUrls = new Set(history.flatMap((h) => (h.meshBlobUrl ? [h.meshBlobUrl] : [])))
  if (freshMeshUrl && !isOwnMeshUrl(freshMeshUrl, session.user.id, ownMeshUrls)) {
    return apiError(403, 'forbidden_mesh', 'A malha não pertence a este projeto.')
  }

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
      log.error('describeImage failed (continuing)', err, { iterationId: iteration.id })
    }
  }

  // Load logo image buffer up front — needed both for the aspect-ratio hint
  // passed to the LLM and for the geometry build.
  let logoImageBuffer: Buffer | null = null
  if (effectiveImageUrl) {
    try {
      if (effectiveImageUrl.startsWith('http')) {
        const r = await fetch(effectiveImageUrl, { redirect: 'manual' })
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        logoImageBuffer = Buffer.from(await r.arrayBuffer())
      } else {
        const publicDir = join(process.cwd(), 'public')
        const rel = effectiveImageUrl.startsWith('/') ? effectiveImageUrl.slice(1) : effectiveImageUrl
        const real = await realpath(join(publicDir, rel))
        if (real !== publicDir && !real.startsWith(publicDir + sep)) {
          throw new Error('image path escapes public dir')
        }
        logoImageBuffer = await readFile(real)
      }
    } catch (err) {
      log.error('image fetch failed (continuing without logo)', err, { iterationId: iteration.id })
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
        return apiError(400, 'previews_required', 'A edição de malha importada exige as pré-visualizações (o cliente deve capturá-las e enviá-las no primeiro pedido).', { iteration_id: iteration.id })
      }
      importContext = {
        baseMeshUrl: effectiveMeshUrl,
        faces,
        previewDataUrls: previews,
        bboxMm: base.bbox.size as [number, number, number],
      }
    } catch (err) {
      log.error('base mesh load/segment failed', err, { iterationId: iteration.id, meshUrl: effectiveMeshUrl })
      await db.update(iterations)
        .set({ status: 'failed', error: `base mesh load failed: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return apiError(500, 'base_mesh_failed', 'Não foi possível carregar a malha base.', { iteration_id: iteration.id })
    }
  }

  // LLM → structured Design. Pull the most recent successfully-built Design
  // from this project's history (stored in `validationReport` jsonb) so the
  // LLM can iterate on it instead of re-parsing from scratch.
  const lastReadyWithDesign = [...history]
    .reverse()
    .find((h) => h.status === 'ready' && h.validationReport)
  // Strip `_`-prefixed cache keys (_faces/_previews — base64 PNGs up to ~806KB)
  // so they never get stringified into the LLM prompt.
  const previousDesign = stripCacheKeys(lastReadyWithDesign?.validationReport ?? null) as
    | Awaited<ReturnType<typeof parseDesign>>
    | null

  const allMessages = history.map((h) => h.userMessage).concat([message])
  let design: Design
  let designAdjustments: Array<{ field: string; from: number; to: number }> = []
  let designSource: 'llm' | 'override' | 'quick_modifier' = 'llm'
  try {
    let candidate: Awaited<ReturnType<typeof parseDesign>>
    if (logoPlacement) {
      // Click-to-place: build the imported edit directly from the picked point —
      // no LLM, no semantic-face guesswork. The logo lands exactly where clicked.
      if (!effectiveMeshUrl) {
        await db.update(iterations)
          .set({ status: 'failed', error: 'logoPlacement requires an imported base mesh' })
          .where(eq(iterations.id, iteration.id))
        return apiError(400, 'no_imported_mesh', 'Nenhuma malha importada para posicionar o logo.', { iteration_id: iteration.id })
      }
      candidate = {
        kind: 'imported',
        baseMeshUrl: effectiveMeshUrl,
        edits: [{
          op: 'add_logo',
          anchorPoint: logoPlacement.point,
          anchorNormal: logoPlacement.normal,
          imageUrl: effectiveImageUrl ?? 'logo',
          sizeMm: logoPlacement.sizeMm,
          depthMm: logoPlacement.depthMm,
          treatment: logoPlacement.treatment,
          offsetMm: [0, 0],
        }],
      } as Awaited<ReturnType<typeof parseDesign>>
      designSource = 'override'
    } else if (designOverride) {
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
        log.info('quick modifier matched', { message })
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
      log.info('design clamped', { source: designSource, adjustments: designAdjustments })
    }
  } catch (err) {
    log.error('parseDesign failed', err, { iterationId: iteration.id })
    await db.update(iterations)
      .set({ status: 'failed', error: `design parse failed: ${(err as Error).message}` })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'design_parse_failed', 'Não foi possível interpretar o pedido.', { iteration_id: iteration.id })
  }

  // Build geometry. Freeform → Meshy (organic/figurative shapes the parametric
  // engine can't make); every other kind → the synchronous parametric builder.
  let finalMeshBytes: Uint8Array
  let metaBbox: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  let editWarnings: Array<{ opIndex: number; op: string; reason: string }> = []
  if (design.kind === 'freeform') {
    if (!isMeshyConfigured()) {
      await db.update(iterations)
        .set({ status: 'failed', error: 'Freeform generation not configured (MESHY_API_KEY missing)' })
        .where(eq(iterations.id, iteration.id))
      return apiError(503, 'freeform_unavailable', 'A geração freeform não está configurada.', { iteration_id: iteration.id })
    }
    const apiKey = env.MESHY_API_KEY as string
    const meshy = design.sourceImageUrl
      ? await generateMeshFromImage({ imageUrl: design.sourceImageUrl, apiKey })
      : await generateMesh({ prompt: design.prompt, apiKey })
    if (!meshy.ok) {
      log.error('meshy failed', new Error(meshy.error), { iterationId: iteration.id })
      await db.update(iterations)
        .set({ status: 'failed', error: `meshy failed: ${meshy.error}` })
        .where(eq(iterations.id, iteration.id))
      return apiError(502, 'meshy_failed', 'A geração freeform falhou.', { iteration_id: iteration.id })
    }
    finalMeshBytes = meshy.stl
  } else {
    let result
    try {
      result = await generateFromDesign(design, { logoImageBuffer })
    } catch (err) {
      log.error('generator failed', err, { iterationId: iteration.id })
      await db.update(iterations)
        .set({ status: 'failed', error: `build failed: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return apiError(500, 'build_failed', 'Não foi possível gerar a peça.', { iteration_id: iteration.id })
    }
    // Parametric builders produce already-grounded geometry in the correct
    // orientation — no post-processing needed.
    finalMeshBytes = result.bodies.length > 1 ? serialize3mf(result.bodies) : result.stl
    metaBbox = result.meta.bboxMm
    editWarnings = result.warnings
  }

  // Guard the tail: persistMesh + the finalize updates run after the last
  // per-stage try/catch, so a throw here would leave the row 'generating'
  // (the gap the reaper cleans up — but mark it failed immediately too).
  try {
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
        // Record the REAL design kind (was always 'generative' before).
        strategy: designKindToStrategy(design.kind),
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
      warnings: editWarnings,
      meta: {
        kind: design.kind,
        bbox_mm: metaBbox,
      },
    })
  } catch (err) {
    log.error('persist/finalize failed', err, { iterationId: iteration.id })
    await db.update(iterations)
      .set({ status: 'failed', error: `persist failed: ${(err as Error).message}` })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'persist_failed', 'Não foi possível salvar a peça gerada.', { iteration_id: iteration.id })
  }
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
  if (env.BLOB_READ_WRITE_TOKEN) {
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
