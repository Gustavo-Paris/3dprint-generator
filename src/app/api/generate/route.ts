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
import {
  resolveConfig,
  DEFAULT_FILAMENT_COLOR_BODY,
  DEFAULT_FILAMENT_COLOR_ACCENT,
} from '@/lib/settings/store'
import { getPrinter, buildProjectSettings } from '@/lib/print-profile'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { generateHistoryColumns } from '@/db/history-columns'
import { designKindToStrategy } from '@/db/strategy'
import { deriveProjectTitle, DEFAULT_PROJECT_TITLE } from '@/lib/projects/derive-title'
import { reapStuckIterations } from '@/lib/db/reap-stuck-iterations'
import { stripCacheKeys } from '@/lib/design/strip-cache-keys'
import { readCachedDesign } from '@/lib/storage/validation-report'
import { describeImage } from '@/lib/prompt/describe-image'
import { parseDesign } from '@/lib/design/parse'
import { generateFromDesign, readImageAspectRatio } from '@/lib/design/generate'
import { sanitizeDesign } from '@/lib/design/sanitize'
import { tryQuickModify } from '@/lib/design/quick-modifier'
import type { Design } from '@/lib/design/schema'
import { Body } from './body-schema'
import type { PreviewBundle } from '@/lib/design/parse-import'
import {
  STUB_PREVIEW,
  STUB_PREVIEW_BUNDLE,
  isStubPreviewBundle,
  readPreviewBundle,
} from '@/lib/design/preview-bundle'
import type { SemanticFace } from '@/lib/import/types'
import { serialize3mf } from '@/lib/3mf/serialize-3mf'
import { generateMesh, generateMeshFromImage } from '@/lib/meshy/client'
import { apiError } from '@/lib/http/api-error'
import { assertUrlIsPublic } from '@/lib/http/is-public-url'
import { isOwnMeshUrl } from '@/lib/http/owns-mesh-url'
import { persistMesh } from '@/lib/storage/persist'
import { createRequestLogger } from '@/lib/log'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { readFile, realpath } from 'node:fs/promises'
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
  const {
    projectId, message, imageUrl, meshUrl: freshMeshUrl, previewDataUrls: freshPreviews,
    ignoreImportedBase, designOverride, logoPlacement, paintPlacement,
  } = parsed.data

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
  // Lean projection: `_previews` (base64 PNGs, ~806KB/row) is stripped at the
  // SQL level — the LLM path re-fetches the newest real bundle in a targeted
  // single-row query below. `_faces` stays (cached segmentation reused on
  // iterate).
  const history = await db
    .select(generateHistoryColumns)
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
  // Fresh upload wins for the mesh URL; faces/previews always prefer history cache
  // so follow-up paints ("tenta de novo") work without re-capturing 4 views.
  let effectiveMeshUrl: string | null = freshMeshUrl ?? null
  let cachedFaces: SemanticFace[] | null = null

  // "Nova peça do zero": the client asked to ignore the imported base — skip the
  // history fallback entirely (an explicit fresh meshUrl in the SAME request
  // still wins above). Without this flag a project with an imported base can
  // never generate from scratch again (audit P1: no exit from imported mode).
  const lastImported = ignoreImportedBase ? undefined : [...history].reverse().find((h) => {
    const vr = readCachedDesign(h.validationReport)
    return vr?.kind === 'imported' && !!vr.baseMeshUrl
  })
  if (lastImported) {
    const vr = readCachedDesign(lastImported.validationReport)
    if (vr?.kind === 'imported') {
      if (!effectiveMeshUrl) effectiveMeshUrl = vr.baseMeshUrl
      cachedFaces = (vr._faces ?? null) as SemanticFace[] | null
    }
  }

  // Post-reload LLM edits must not run vision-blind: `_previews` is stripped
  // from the bulk history read (prompt-size), so re-fetch ONLY the newest REAL
  // preview bundle in a targeted single-row query (legacy stub bundles are
  // filtered in SQL). Skipped on the no-LLM paths (paint/logo placement,
  // designOverride) — they ignore previews entirely.
  let cachedPreviews: PreviewBundle | null = null
  if (!freshPreviews && lastImported && !paintPlacement && !logoPlacement && !designOverride) {
    try {
      const [prevRow] = await db
        .select({ previews: sql<unknown>`${iterations.validationReport} -> '_previews'` })
        .from(iterations)
        .where(
          and(
            eq(iterations.projectId, projectId),
            sql`${iterations.validationReport} -> '_previews' ->> 'iso' <> ${STUB_PREVIEW}`,
          ),
        )
        .orderBy(desc(iterations.createdAt))
        .limit(1)
      cachedPreviews = prevRow ? readPreviewBundle(prevRow.previews) : null
    } catch (err) {
      // Non-fatal: worst case the LLM sees the stub bundle (old behavior).
      log.error('cached previews fetch failed (continuing with stub)', err, {
        iterationId: iteration.id,
      })
    }
  }

  let importContext: Parameters<typeof parseDesign>[0]['importContext'] | undefined
  if (effectiveMeshUrl) {
    try {
      const { loadBaseMeshFromUrl } = await import('@/lib/import/load-base-mesh')
      const { segmentFaces } = await import('@/lib/import/face-segment')

      const base = await loadBaseMeshFromUrl(effectiveMeshUrl)
      const faces = cachedFaces ?? segmentFaces(base)
      const previews = freshPreviews ?? cachedPreviews ?? STUB_PREVIEW_BUNDLE
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
  // 'sliced' rows carry a design too (POST /api/slice flips 'ready' → 'sliced'
  // keeping validationReport) — excluding them broke continuity after slicing.
  // With ignoreImportedBase, imported designs must not become previousDesign
  // either — the LLM would echo kind:'imported' + baseMeshUrl and the generator
  // would reload the base, defeating the "nova peça do zero" toggle.
  const lastReadyWithDesign = [...history]
    .reverse()
    .find((h) =>
      (h.status === 'ready' || h.status === 'sliced') &&
      h.validationReport &&
      !(ignoreImportedBase && readCachedDesign(h.validationReport)?.kind === 'imported'),
    )
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
    if (paintPlacement) {
      if (!effectiveMeshUrl) {
        await db.update(iterations)
          .set({ status: 'failed', error: 'paintPlacement requires an imported base mesh' })
          .where(eq(iterations.id, iteration.id))
        return apiError(400, 'no_imported_mesh', 'Nenhuma malha importada para pintar.', { iteration_id: iteration.id })
      }
      // Fast path: paint on top of the *current* mesh (already coloured), not
      // the raw import + full edit history. Replaying paint_from_image + every
      // prior brush on a 1M-tri sculpt OOM'd the server on each click.
      // 'sliced' is mesh-backed too (POST /api/slice flips 'ready' → 'sliced'
      // while keeping meshBlobUrl) — skipping it would discard prior paint.
      // Only imported-kind rows qualify: a parametric STL row's mesh is never
      // a valid paint base for the imported flow.
      const lastPaintedMesh = [...history]
        .reverse()
        .find(
          (h) =>
            (h.status === 'ready' || h.status === 'sliced') &&
            h.meshBlobUrl &&
            readCachedDesign(h.validationReport)?.kind === 'imported',
        )?.meshBlobUrl
      const paintBaseUrl = lastPaintedMesh ?? effectiveMeshUrl
      candidate = {
        kind: 'imported',
        baseMeshUrl: paintBaseUrl,
        edits: [
          {
            op: 'paint_brush',
            point: paintPlacement.point,
            extruder: paintPlacement.extruder,
            mode: paintPlacement.mode ?? 'radius',
            radiusMm: paintPlacement.radiusMm,
            featureAngleDeg: paintPlacement.featureAngleDeg ?? 38,
          },
        ],
      } as Awaited<ReturnType<typeof parseDesign>>
      designSource = 'override'
    } else if (logoPlacement) {
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
      // Deterministic pattern matching first — no LLM when we can avoid it.
      // Parametric: "logo maior", …  Imported: paint_from_image when ref image present.
      let quick: Awaited<ReturnType<typeof parseDesign>> | null = null
      if (importContext) {
        const { tryQuickPaintImport } = await import('@/lib/design/quick-paint-import')
        quick = tryQuickPaintImport(message, importContext.baseMeshUrl, previousDesign, {
          hasReferenceImage: !!logoImageBuffer,
        })
      } else {
        quick = tryQuickModify(message, previousDesign)
      }
      if (quick) {
        candidate = quick
        designSource = 'quick_modifier'
        log.info('quick modifier matched', { message, imported: !!importContext })
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
  let paintPalette: { A: string; B: string } | undefined
  if (design.kind === 'freeform') {
    const { meshyApiKey: apiKey } = await resolveConfig()
    if (!apiKey) {
      await db.update(iterations)
        .set({ status: 'failed', error: 'Freeform generation not configured (Meshy key missing)' })
        .where(eq(iterations.id, iteration.id))
      return apiError(503, 'freeform_unavailable', 'A geração freeform não está configurada.', { iteration_id: iteration.id })
    }
    // Network/transport failures THROW (unlike Meshy HTTP errors, which come
    // back as { ok: false }) — without this guard the row stayed 'generating'.
    let meshy: Awaited<ReturnType<typeof generateMesh>>
    try {
      meshy = design.sourceImageUrl
        ? await generateMeshFromImage({ imageUrl: design.sourceImageUrl, apiKey })
        : await generateMesh({ prompt: design.prompt, apiKey })
    } catch (err) {
      log.error('meshy threw', err, { iterationId: iteration.id })
      await db.update(iterations)
        .set({ status: 'failed', error: `meshy failed: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return apiError(502, 'meshy_failed', 'A geração freeform falhou.', { iteration_id: iteration.id })
    }
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
    // orientation — no post-processing needed (no standing re-orientation here).
    if (result.bodies.length > 1) {
      const cfg = await resolveConfig()
      const printer = getPrinter(cfg.printerModel)
      const colors = {
        bodyHex: cfg.filamentColorBody ?? DEFAULT_FILAMENT_COLOR_BODY,
        accentHex: cfg.filamentColorAccent ?? DEFAULT_FILAMENT_COLOR_ACCENT,
      }
      finalMeshBytes = serialize3mf(result.bodies, {
        colors: { aHex: colors.bodyHex, bHex: colors.accentHex },
        projectSettings: buildProjectSettings(
          printer,
          { multicolor: true, standing: false },
          colors,
        ),
      })
    } else {
      finalMeshBytes = result.stl
    }
    metaBbox = result.meta.bboxMm
    editWarnings = result.warnings
    paintPalette = result.meta.paintPalette
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
        ? {
            ...(design as object),
            _faces: importContext.faces,
            // Never cache the 1×1 stub bundle — the cached-previews re-fetch
            // above must only ever find REAL captures to carry forward.
            ...(isStubPreviewBundle(importContext.previewDataUrls)
              ? {}
              : { _previews: importContext.previewDataUrls }),
            ...(paintPalette ? { _paintPalette: paintPalette } : {}),
          }
        : {
            ...(design as unknown as Record<string, unknown>),
            ...(paintPalette ? { _paintPalette: paintPalette } : {}),
          }

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

    // Auto-title: first successful build of a still-default-titled project
    // names it after the prompt. Best-effort — never fails the response.
    if (project.title === DEFAULT_PROJECT_TITLE) {
      try {
        const derived = deriveProjectTitle(message)
        if (derived !== DEFAULT_PROJECT_TITLE) {
          await db.update(projects)
            .set({ title: derived })
            .where(eq(projects.id, projectId))
        }
      } catch (err) {
        log.error('auto-title failed (non-fatal)', err, { projectId })
      }
    }

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
        paint_palette: paintPalette,
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
