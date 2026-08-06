'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { BrandMark } from '@/components/Brand'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import type { HistoryRow } from '@/db/history-columns'
import Chat, { type ChatResult, type PreviewBundle } from './Chat'
import type { MeshBody, MeshViewerHandle } from './MeshViewer'
import SliceButton from './SliceButton'
import DownloadStlButton from './DownloadStlButton'
import FlexifyButton from './FlexifyButton'
import MeshValidityBanner from './MeshValidityBanner'
import { extractApiError } from '@/lib/http/client-error'
import { runInWorker } from '@/lib/jscad/worker-client'
import type { MeshValidityReport } from '@/lib/mesh/validity'
import type { BaseMesh } from '@/lib/import/types'

// Defer the three.js + R3F + drei graph (~928KB) off the workspace's eager
// chunk. ssr:false is valid here — ProjectWorkspace is a Client Component
// (next docs: lazy-loading, ssr:false only works in Client Components); the
// viewer relies on WebGL/canvas APIs that don't exist during SSR. The ref
// (meshViewerRef → capturePreviews) forwards through dynamic() under React 19.
const MeshViewer = dynamic(() => import('./MeshViewer'), {
  ssr: false,
  loading: () => (
    <div
      data-testid="viewer-skeleton"
      className="studio-stage absolute inset-0 flex items-center justify-center text-sm text-slate-400"
    >
      Carregando visualizador 3D…
    </div>
  ),
})

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

type ChatMsg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
  imageUrl?: string
  status?: 'generating' | 'ready' | 'failed' | 'sliced'
  design?: unknown
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Inverse of base64ToUint8 for POST /api/paint-save: encode a Float32Array's
 *  raw little-endian bytes as base64. Chunked String.fromCharCode — a 25MB
 *  spread in one call blows the JS arg limit. */
export function float32ToBase64(positions: Float32Array): string {
  const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** The "Logo aqui" placement only works on an imported base mesh — a fresh .3mf
 *  upload (pendingMeshUrl) or a history row whose design kind is 'imported'.
 *  Parametric projects 400 on logoPlacement, so the control is hidden there. */
export function hasImportedBase(
  history: Pick<Iteration, 'validationReport'>[],
  pendingMeshUrl: string | null,
): boolean {
  if (pendingMeshUrl) return true
  return history.some((it) => {
    const vr = it.validationReport as { kind?: string } | null
    return vr?.kind === 'imported'
  })
}

/** Design kinds whose meshes can be hand-painted. Paint runs 100% client-side
 *  on whatever triangle soup is in the viewer, so any mesh-backed kind works —
 *  unlike "Logo aqui", which stays gated on `hasImportedBase` (the server op
 *  requires an imported base). */
const PAINTABLE_KINDS = new Set(['imported', 'freeform', 'flexified'])

export function hasPaintableMesh(
  history: Pick<Iteration, 'validationReport'>[],
  pendingMeshUrl: string | null,
): boolean {
  if (pendingMeshUrl) return true
  return history.some((it) => {
    const vr = it.validationReport as { kind?: string } | null
    return vr?.kind != null && PAINTABLE_KINDS.has(vr.kind)
  })
}

/**
 * Suggest a logo size that fills most of the visible face (not a tiny stamp).
 * Uses the two largest bbox axes as the face, takes ~80% of the smaller of
 * those, clamped to a printable range.
 */
export function suggestedLogoSizeMm(positions: Float32Array | null | undefined): number {
  if (!positions || positions.length < 9) return 45
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const dims = [maxX - minX, maxY - minY, maxZ - minZ].sort((a, b) => b - a)
  // dims[0]=longest, dims[1]=second → characteristic face width
  const face = Math.min(dims[0], dims[1])
  return Math.round(Math.max(28, Math.min(140, face * 0.8)))
}

/** Body for POST /api/generate click-to-place logo. Must include pending mesh +
 *  image the same way Chat.send does — otherwise a fresh .3mf upload shows the
 *  placement UI (hasImportedBase) but the API returns 400 no_imported_mesh. */
export function buildLogoPlacementBody(opts: {
  projectId: string
  message: string
  logoPlacement: {
    point: [number, number, number]
    normal: [number, number, number]
    treatment: 'embossed' | 'engraved'
    sizeMm: number
    depthMm: number
  }
  pendingMeshUrl: string | null
  pendingPreviews: PreviewBundle | null
  imageUrl: string | null
}) {
  return {
    projectId: opts.projectId,
    message: opts.message,
    meshUrl: opts.pendingMeshUrl ?? undefined,
    previewDataUrls: opts.pendingPreviews ?? undefined,
    imageUrl: opts.imageUrl ?? undefined,
    logoPlacement: opts.logoPlacement,
  }
}

/** Build the chat transcript from iteration history, branching on status so a
 *  failed row shows its error and an in-flight row shows a spinner label —
 *  instead of every row reading as "Generated". */
export function mapHistoryToMessages(history: HistoryRow[]): ChatMsg[] {
  return history.flatMap((it) => {
    const userMsg: ChatMsg = {
      role: 'user',
      text: it.userMessage,
      imageUrl: it.imageBlobUrl ?? undefined,
    }
    if (it.status === 'failed') {
      return [userMsg, {
        role: 'assistant' as const,
        text: `Falhou: ${it.error ?? 'erro desconhecido'}`,
        iterationId: it.id,
        status: 'failed' as const,
      }]
    }
    if (it.status === 'generating') {
      return [userMsg, {
        role: 'assistant' as const,
        text: 'Gerando…',
        iterationId: it.id,
        status: 'generating' as const,
      }]
    }
    if (it.strategy === 'parametric' && it.jscadCode) {
      return [userMsg, {
        role: 'assistant' as const,
        text: 'Modelo paramétrico gerado',
        iterationId: it.id,
        strategy: 'parametric' as const,
        status: it.status,
      }]
    }
    // Mesh-backed strategies (legacy 'generative' + real design kinds: imported,
    // freeform, flexified, …). Any ready row with a meshBlobUrl hydrates the chat.
    if (it.meshBlobUrl && (it.status === 'ready' || it.status === 'sliced')) {
      const design = it.validationReport ?? undefined
      const kind = (design as { kind?: string } | undefined)?.kind ?? it.strategy
      const text =
        kind === 'imported' ? 'Malha importada atualizada'
        : kind === 'freeform' ? 'Modelo freeform gerado'
        : kind === 'lsf_maquette' ? 'Maquete LSF pronta'
        : 'Pronto'
      return [userMsg, {
        role: 'assistant' as const,
        text,
        iterationId: it.id,
        strategy: 'generative' as const,
        status: it.status,
        design,
      }]
    }
    return [userMsg]
  })
}

/** Resolve a chat "Ver esta versão" click to a loadable history row. Only rows
 *  with viewable output (ready/sliced) qualify; live-session iterations are not
 *  in `initialHistory` and return null (reload the page to navigate them). */
export function resolveViewableRow<T extends Pick<HistoryRow, 'id' | 'status'>>(
  history: T[],
  id: string,
): T | null {
  const row = history.find((it) => it.id === id)
  if (!row) return null
  if (row.status !== 'ready' && row.status !== 'sliced') return null
  return row
}

export default function ProjectWorkspace({
  project,
  initialHistory,
  printConfig,
}: {
  project: Project
  initialHistory: HistoryRow[]
  /** Non-secret print settings resolved server-side (Settings singleton). */
  printConfig?: { printerModel: string | null; bodyHex: string; accentHex: string }
}) {
  const lastReady = initialHistory.findLast(
    (it) => it.status === 'ready' || it.status === 'sliced',
  )

  // The most recent image used in this project. Auto-attached in the chat so
  // follow-up messages iterate on the same image instead of generating blind.
  const lastImageUrl =
    initialHistory.filter((it) => it.imageBlobUrl).pop()?.imageBlobUrl ?? null

  const [iterationId, setIterationId] = useState<string | null>(lastReady?.id ?? null)
  const [positions, setPositions] = useState<Float32Array | null>(null)
  const [bodies, setBodies] = useState<MeshBody[] | null>(null)
  const [stl, setStl] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Advisory mesh-validity report for whatever mesh is currently in the viewer.
  const [validity, setValidity] = useState<MeshValidityReport | null>(null)
  /** LSF maquete: multi-body non-watertight is expected — calm validity banner. */
  const [expectMultiBody, setExpectMultiBody] = useState(
    () =>
      (lastReady?.validationReport as { kind?: string } | null)?.kind === 'lsf_maquette' ||
      lastReady?.strategy === 'lsf_maquette',
  )

  // 3MF import flow: track the pending mesh URL + captured previews.
  const meshViewerRef = useRef<MeshViewerHandle>(null)
  const [pendingMeshUrl, setPendingMeshUrl] = useState<string | null>(null)
  const [pendingPreviews, setPendingPreviews] = useState<PreviewBundle | null>(null)
  // Live chat attachment (Chat owns the upload UI). Needed so logo placement
  // can send imageUrl before any history row exists for this image.
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(lastImageUrl)

  // Seed pickers from the last stored paint palette (if any) at first render —
  // seeding via effect would be a sync setState (cascading render). The Settings
  // print colours are just the INITIAL default; from here on, the panel pickers
  // are the source of truth for viewer + exported 3MF (WYSIWYG).
  const storedPalette = (lastReady?.validationReport as { _paintPalette?: { A: string; B: string } } | null)
    ?._paintPalette
  const [bodyColor, setBodyColor] = useState(
    storedPalette?.A && storedPalette?.B ? storedPalette.A : (printConfig?.bodyHex ?? '#3b82f6'),
  )
  const [logoColor, setLogoColor] = useState(
    storedPalette?.A && storedPalette?.B ? storedPalette.B : (printConfig?.accentHex ?? '#f8fafc'),
  )
  /** Keep labeled mesh between clicks so we don't rebuild from bodies every time. */
  const paintMeshRef = useRef<BaseMesh | null>(null)

  // "Ver esta versão" (chat): id of the OLD iteration currently shown in the
  // viewer (null = viewing the current one). Entering view mode snapshots the
  // current viewer state so "Voltar à atual" restores it without refetching —
  // this also covers live-session iterations that aren't in initialHistory.
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const viewSnapshotRef = useRef<{
    iterationId: string | null
    positions: Float32Array | null
    bodies: MeshBody[] | null
    stl: Uint8Array | null
    validity: MeshValidityReport | null
    paintMesh: BaseMesh | null
  } | null>(null)

  /**
   * Load one iteration row into the viewer (parametric rows re-run their JSCAD
   * in the worker; mesh rows fetch + parse the blob). Shared by the mount
   * hydrate below and by "Ver esta versão" (chat version navigation).
   */
  async function loadIterationRow(
    row: Pick<HistoryRow, 'strategy' | 'jscadCode' | 'meshBlobUrl' | 'validationReport'>,
    isCancelled: () => boolean = () => false,
  ): Promise<void> {
    try {
      setError(null)
      setValidity(null)
      const designKind = (row.validationReport as { kind?: string } | null)?.kind
      setExpectMultiBody(
        designKind === 'lsf_maquette' || row.strategy === 'lsf_maquette',
      )
      if (row.strategy === 'parametric' && row.jscadCode) {
        const r = await runInWorker({ type: 'jscad', code: row.jscadCode })
        if (isCancelled()) return
        if (r.ok) {
          setPositions(r.positions)
          setStl(r.stl)
          setBodies(r.bodies)
          paintMeshRef.current = null
          setValidity(r.validity ?? null)
        } else setError(r.error)
      } else if (row.meshBlobUrl) {
        // Mesh URL present — covers generative, imported, freeform, flexified, …
        const res = await fetch(row.meshBlobUrl)
        if (!res.ok) throw new Error(`Não foi possível carregar a peça (HTTP ${res.status}). Recarregue a página ou gere novamente.`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        const r = await runInWorker({ type: 'stl', stl: bytes })
        if (isCancelled()) return
        if (r.ok) {
          setPositions(r.positions)
          setStl(bytes)
          setBodies(r.bodies)
          paintMeshRef.current = null
          setValidity(r.validity ?? null)
        } else setError(r.error)
      }
    } catch (e) {
      if (!isCancelled()) setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Hydrate viewer from last ready iteration on mount.
  useEffect(() => {
    if (!lastReady) return
    let cancelled = false
    ;(async () => {
      await loadIterationRow(lastReady, () => cancelled)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReady?.id])

  // When a .3mf is uploaded and loaded into the viewer, capture 4-angle previews.
  // The 500ms delay lets R3F render at least one frame with the new mesh before
  // we call toDataURL on the canvas.
  useEffect(() => {
    if (!pendingMeshUrl || pendingPreviews) return
    const t = setTimeout(async () => {
      if (!meshViewerRef.current) return
      try {
        const previews = await meshViewerRef.current.capturePreviews()
        setPendingPreviews(previews)
      } catch (e) {
        console.error('[ProjectWorkspace] preview capture failed', e)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [pendingMeshUrl, pendingPreviews])

  /**
   * Called by Chat when a .3mf file is successfully uploaded.
   * Loads the mesh into the viewer so CaptureHelper can render it and
   * the useEffect above will capture 4-angle previews automatically.
   */
  async function onMeshUploaded(meshUrl: string) {
    setPendingMeshUrl(meshUrl)
    setPendingPreviews(null)
    setError(null)
    setValidity(null)
    try {
      const res = await fetch(meshUrl)
      if (!res.ok) throw new Error(`Não foi possível carregar a peça (HTTP ${res.status}). Recarregue a página ou gere novamente.`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const result = await runInWorker({ type: 'stl', stl: bytes })
      if (result.ok) {
        setPositions(result.positions)
        setStl(bytes)
        setBodies(result.bodies)
        setValidity(result.validity ?? null)
      } else {
        setError(result.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onResult(r: ChatResult) {
    setIterationId(r.iterationId)
    setError(null)
    setValidity(null)
    if (r.kind === 'generative') {
      setExpectMultiBody(r.designKind === 'lsf_maquette')
    } else {
      setExpectMultiBody(false)
    }
    // A fresh generation always shows the newest result — drop any "viewing an
    // old version" state (the snapshot is stale once a new iteration lands).
    setViewingVersionId(null)
    viewSnapshotRef.current = null
    // The viewer is about to swap to a brand-new server mesh — any local paint
    // session refers to the PREVIOUS mesh. Keeping it would let "Salvar pintura"
    // persist the stale pre-generation soup as the newest iteration (and the
    // brush would repaint the old mesh). Drop the session: the next brush click
    // rebuilds paintMeshRef from the new bodies.
    paintMeshRef.current = null
    setPaintDirty(false)
    setPaintSaved(false)
    setPaintHint(null)
    // Keep mesh URL + previews for follow-up paints ("tenta de novo") so the
    // client can re-send them; server also caches _previews in validationReport.
    // Only drop "pending" status after a successful generate once previews exist.
    if (pendingMeshUrl && pendingPreviews) {
      // stay available as sticky import context for the chat
    }
    if (r.kind === 'generative' && r.paintPalette) {
      setBodyColor(r.paintPalette.A)
      setLogoColor(r.paintPalette.B)
    }
    try {
      if (r.kind === 'parametric') {
        const result = await runInWorker({ type: 'jscad', code: r.code })
        if (result.ok) {
          setPositions(result.positions)
          setStl(result.stl)
          setBodies(result.bodies)
          setValidity(result.validity ?? null)
        } else setError(result.error)
      } else {
        let bytes: Uint8Array
        if (r.meshUrl) {
          const res = await fetch(r.meshUrl)
          if (!res.ok) throw new Error(`Não foi possível carregar a peça (HTTP ${res.status}). Recarregue a página ou gere novamente.`)
          bytes = new Uint8Array(await res.arrayBuffer())
        } else if (r.meshBase64) {
          bytes = base64ToUint8(r.meshBase64)
        } else {
          throw new Error('Generative result has no mesh URL or inline bytes')
        }
        const result = await runInWorker({ type: 'stl', stl: bytes })
        if (result.ok) {
          setPositions(result.positions)
          setStl(bytes)
          setBodies(result.bodies)
          setValidity(result.validity ?? null)
        } else setError(result.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const initialMessages: ChatMsg[] = mapHistoryToMessages(initialHistory)
  const importedBaseAvailable = hasImportedBase(initialHistory, pendingMeshUrl)
  // Paint works on any mesh-backed kind (client-side); logo needs an imported base.
  const paintableMeshAvailable = hasPaintableMesh(initialHistory, pendingMeshUrl)
  // Multi-colour when the viewer holds more than one extruder body — slicing
  // flattens to mono (estimate only), so the result card says so.
  const multicolorMesh = !!bodies && new Set(bodies.map((b) => b.extruder)).size > 1

  // Click-to-place logo: toggle pick mode, capture the picked point + normal,
  // then POST it as a logoPlacement (no LLM, lands exactly where clicked).
  const [pickMode, setPickMode] = useState(false)
  /** Click-to-paint multi-colour (extruder B) on imported meshes. */
  const [paintMode, setPaintMode] = useState(false)
  /** radius = sphere brush; fill = paint-bucket (closed surface region). */
  const [paintTool, setPaintTool] = useState<'fill' | 'radius'>('fill')
  const [paintRadiusMm, setPaintRadiusMm] = useState(14)
  const [paintExtruder, setPaintExtruder] = useState<'A' | 'B'>('B')
  const [paintDirty, setPaintDirty] = useState(false)
  /** True after a successful POST /api/paint-save (until the next brush). */
  const [paintSaved, setPaintSaved] = useState(false)
  const [paintHint, setPaintHint] = useState<string | null>(null)
  const [pick, setPick] = useState<{
    point: [number, number, number]
    normal: [number, number, number]
  } | null>(null)
  const [placeTreatment, setPlaceTreatment] = useState<'embossed' | 'engraved'>('engraved')
  // Default grows once the mesh is known (see Logo aqui toggle).
  const [placeSizeMm, setPlaceSizeMm] = useState(45)
  const [placing, setPlacing] = useState(false)
  // Keyboard alternative to click-to-place: mm offsets from the mesh top-center.
  const [logoX, setLogoX] = useState(0)
  const [logoY, setLogoY] = useState(0)

  /** Build a mesh-space placement from X/Y mm offsets relative to the mesh
   *  bbox top-center (normal +Z). The keyboard alternative to a canvas click. */
  function placementFromOffsets(x: number, y: number): {
    point: [number, number, number]
    normal: [number, number, number]
  } {
    if (!positions || positions.length === 0) {
      return { point: [x, y, 0], normal: [0, 0, 1] }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i], py = positions[i + 1], pz = positions[i + 2]
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      if (pz > maxZ) maxZ = pz
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    return { point: [cx + x, cy + y, maxZ], normal: [0, 0, 1] }
  }

  async function applyLogoPlacement(placement?: {
    point: [number, number, number]
    normal: [number, number, number]
  }) {
    const p = placement ?? pick
    if (!p) return
    setPlacing(true)
    setError(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          buildLogoPlacementBody({
            projectId: project.id,
            message: `logo ${placeTreatment === 'engraved' ? 'gravado' : 'em relevo'} (posicionado no viewer)`,
            logoPlacement: {
              point: p.point,
              normal: p.normal,
              treatment: placeTreatment,
              sizeMm: placeSizeMm,
              // Multi-colour engraving needs ≥ ~2 layers of B filament.
              depthMm: placeTreatment === 'engraved' ? 1.6 : 1.4,
            },
            pendingMeshUrl,
            pendingPreviews,
            imageUrl: attachedImageUrl,
          }),
        ),
      })
      if (!res.ok) throw new Error(await extractApiError(res))
      const body = (await res.json()) as {
        iteration_id: string
        mesh_url: string | null
        mesh_base64: string | null
        warnings?: Array<{ op: string; reason: string }>
      }
      if (body.warnings && body.warnings.length > 0) {
        setError(body.warnings.map((w) => `${w.op}: ${w.reason}`).join(' · '))
      }
      await onResult({
        kind: 'generative',
        iterationId: body.iteration_id,
        meshUrl: body.mesh_url,
        meshBase64: body.mesh_base64,
      })
      setPick(null)
      setPickMode(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPlacing(false)
    }
  }

  /**
   * Paint is 100% client-side (Web Worker). The Next server is NEVER called on
   * click — loading/writing 50MB meshes was killing Node. Use "Exportar 3MF"
   * when you want a file; optional save stays off the critical path.
   */
  async function applyPaintBrush(point: [number, number, number]) {
    if (placing) return
    if (!bodies || bodies.length === 0) {
      setError('Malha ainda não carregou — espere um instante e clique de novo.')
      return
    }
    setPlacing(true)
    setError(null)
    setPaintHint(null)
    try {
      const { bodiesToMesh, meshToBodies } = await import('@/lib/3mf/paint-bin')
      const { runPaintInWorker } = await import('@/lib/paint/run-paint-worker')

      if (!paintMeshRef.current || paintMeshRef.current.triangleCount === 0) {
        paintMeshRef.current = bodiesToMesh(bodies)
      }

      const painted = await runPaintInWorker({
        mesh: paintMeshRef.current,
        point,
        extruder: paintExtruder,
        mode: paintTool,
        radiusMm: paintRadiusMm,
        featureAngleDeg: 38,
      })
      paintMeshRef.current = painted
      setBodies(meshToBodies(painted))
      setPositions(painted.positions)
      setPaintDirty(true)
      setPaintSaved(false)
      setPaintHint('Pintura local — use "Salvar pintura" para incluí-la no Fatiar.')
    } catch (e) {
      setError(String(e))
    } finally {
      setPlacing(false)
    }
  }

  /** One-shot export of multi-colour 3MF in the browser — no server. */
  async function exportPainted3mf() {
    if (!paintMeshRef.current) {
      setError('Nada pintado ainda.')
      return
    }
    setPlacing(true)
    setError(null)
    try {
      const { meshToBodies } = await import('@/lib/3mf/paint-bin')
      const { runSerialize3mfInWorker } = await import('@/lib/3mf/run-serialize-worker')
      const { getPrinter, buildProjectSettings, planStandingOrientation } =
        await import('@/lib/print-profile')
      let bodiesOut = meshToBodies(paintMeshRef.current).map((b) => ({
        positions: b.positions,
        extruder: b.extruder,
        label: b.label,
      }))

      // Decide "print standing" from the FULL soup (all bodies concatenated),
      // then apply the SAME rigid transform to each body so they stay aligned.
      const totalFloats = bodiesOut.reduce((n, b) => n + b.positions.length, 0)
      const allPositions = new Float32Array(totalFloats)
      let offset = 0
      for (const b of bodiesOut) {
        allPositions.set(b.positions, offset)
        offset += b.positions.length
      }
      const plan = planStandingOrientation(allPositions)
      if (plan.standing) {
        bodiesOut = bodiesOut.map((b) => ({ ...b, positions: plan.apply(b.positions) }))
      }

      // WYSIWYG: the exported 3MF uses the PANEL colours (exactly what the
      // viewer shows). Settings print colours are only the pickers' initial
      // default — they never silently override what the user sees.
      const colors = { bodyHex: bodyColor, accentHex: logoColor }
      const projectSettings = buildProjectSettings(
        getPrinter(printConfig?.printerModel),
        { multicolor: true, standing: plan.standing },
        colors,
      )
      // Weld + XML + zip run in a Web Worker — serializing a 700k-tri mesh
      // inline froze the UI for ~4s. `bodiesOut` positions are freshly
      // allocated (meshToBodies / plan.apply), so transferring them is safe.
      const bytes = await runSerialize3mfInWorker(bodiesOut, {
        colors: { aHex: colors.bodyHex, bHex: colors.accentHex },
        projectSettings,
      })
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${project.id.slice(0, 8)}-painted.3mf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
      setPaintHint(
        projectSettings
          ? '3MF exportado — abre no Bambu Studio já com perfil de impressão.'
          : '3MF exportado no seu computador (sem passar pelo server).',
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setPlacing(false)
    }
  }

  /**
   * Persist the client-side paint session as a NEW iteration via
   * POST /api/paint-save, so "Fatiar" (which slices the server-persisted mesh)
   * includes the colours. One body per extruder, positions as base64 floats.
   */
  async function savePaint() {
    const baseIterationId = viewingVersionId ?? iterationId
    if (!paintMeshRef.current || !baseIterationId) {
      setError('Nada pintado ainda.')
      return
    }
    setPlacing(true)
    setError(null)
    try {
      const { meshToBodies } = await import('@/lib/3mf/paint-bin')
      const bodiesPayload = meshToBodies(paintMeshRef.current).map((b) => ({
        positionsB64: float32ToBase64(b.positions),
        extruder: b.extruder,
        label: b.label,
      }))
      const res = await fetch('/api/paint-save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          iterationId: baseIterationId,
          bodies: bodiesPayload,
          palette: { A: bodyColor, B: logoColor },
        }),
      })
      if (!res.ok) throw new Error(await extractApiError(res))
      const body = (await res.json()) as { iteration_id: string; mesh_url: string }
      // onResult-like: point the workspace at the new iteration. The painted
      // mesh is already in the viewer — no need to re-download 25MB+ of soup.
      setIterationId(body.iteration_id)
      setPaintDirty(false)
      setPaintSaved(true)
      setPaintHint('Pintura salva — o Fatiar agora inclui as cores.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPlacing(false)
    }
  }

  /** Chat "Ver esta versão": load an old iteration's mesh into the viewer. */
  async function onViewIteration(id: string) {
    if (paintDirty) {
      setError('Você tem pintura não salva — salve ou exporte antes de ver outra versão.')
      return
    }
    if (id === (viewingVersionId ?? iterationId)) return
    const row = resolveViewableRow(initialHistory, id)
    if (!row) {
      setError('Versão gerada nesta sessão — recarregue a página para navegar por ela no histórico.')
      return
    }
    if (viewingVersionId === null) {
      // First hop into view mode: snapshot the CURRENT viewer state (may be a
      // live-session iteration that has no initialHistory row to reload from).
      viewSnapshotRef.current = {
        iterationId,
        positions,
        bodies,
        stl,
        validity,
        paintMesh: paintMeshRef.current,
      }
    }
    setViewingVersionId(id)
    await loadIterationRow(row)
  }

  /** Banner "Voltar à atual": restore the snapshotted current viewer state. */
  function backToCurrentVersion() {
    const snap = viewSnapshotRef.current
    setViewingVersionId(null)
    viewSnapshotRef.current = null
    if (!snap) return
    setError(null)
    setPositions(snap.positions)
    setBodies(snap.bodies)
    setStl(snap.stl)
    setValidity(snap.validity)
    paintMeshRef.current = snap.paintMesh
  }

  /**
   * Banner "Restaurar esta versão": make the viewed old iteration the active
   * one CLIENT-SIDE — the viewer keeps its mesh and SliceButton/paint-save now
   * target this iterationId. LIMITATION (deliberate — no new endpoint): chat
   * edits still branch from the newest ready row server-side; restoring only
   * affects what you see, slice and download until a new generation lands.
   */
  function restoreVersion() {
    if (!viewingVersionId) return
    setIterationId(viewingVersionId)
    setViewingVersionId(null)
    viewSnapshotRef.current = null
    setPaintDirty(false)
    setPaintSaved(false)
    setPaintHint(null)
  }

  // While viewing an old version, Fatiar / Baixar / Salvar pintura must target
  // the VIEWED iteration — /api/slice and /api/paint-save read each row's own
  // meshBlobUrl, so binding to the current id would estimate/export a mesh the
  // user isn't looking at. "Restaurar esta versão" rebinds iterationId itself.
  const activeIterationId = viewingVersionId ?? iterationId

  return (
    <main className="h-screen flex flex-col bg-slate-950 text-slate-100 lg:grid lg:grid-cols-[400px_1fr]">
      <aside className="flex flex-col min-h-0 max-h-[45vh] border-b border-slate-800 bg-slate-900 lg:max-h-none lg:border-b-0 lg:border-r">
        <header className="flex items-center gap-2.5 border-b border-slate-800 p-4">
          <Link
            href="/"
            aria-label="Voltar para meus projetos"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            ←
          </Link>
          <BrandMark className="h-5 w-5 shrink-0" />
          <h1 className="flex-1 truncate font-semibold text-white">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          initialAttachedImageUrl={lastImageUrl}
          onResult={onResult}
          onMeshUploaded={onMeshUploaded}
          onAttachedImageChange={setAttachedImageUrl}
          onDiscardMesh={() => {
            setPendingMeshUrl(null)
            setPendingPreviews(null)
          }}
          onViewIteration={(id) => void onViewIteration(id)}
          hasImportedBase={importedBaseAvailable}
          pendingMeshUrl={pendingMeshUrl}
          pendingPreviews={pendingPreviews}
        />
      </aside>
      <section className="relative studio-stage flex-1 min-h-0" data-testid="viewer-slot">
        <MeshViewer
          ref={meshViewerRef}
          positions={positions}
          bodies={bodies}
          fitKey={viewingVersionId ?? iterationId ?? undefined}
          bodyColor={bodyColor}
          logoColor={logoColor}
          pickMode={pickMode || paintMode}
          onPick={(point, normal) => {
            if (paintMode) {
              void applyPaintBrush(point)
              return
            }
            setPick({ point, normal })
          }}
          pickMarker={pick?.point ?? null}
          loading={!!iterationId && positions === null && !error}
        />
        {/* Thin banner while viewing an OLD iteration ("Ver esta versão" in the
            chat). z-30 so neither the bottom sheet (z-10) nor the error alert
            (z-20, top-4 → below this bar) can cover it. */}
        {viewingVersionId && (
          <div
            data-testid="version-banner"
            className="absolute inset-x-0 top-0 z-30 flex flex-wrap items-center gap-2 border-b border-amber-700 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-100 backdrop-blur"
          >
            <span className="font-medium">🕘 Vendo versão antiga</span>
            <span className="hidden text-amber-200/70 sm:inline">
              edições pelo chat continuam partindo da versão mais recente
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={backToCurrentVersion}
              className="min-h-8 rounded border border-amber-600 px-2 py-1 transition hover:bg-amber-900"
            >
              Voltar à atual
            </button>
            <button
              type="button"
              onClick={restoreVersion}
              className="min-h-8 rounded bg-amber-500 px-2 py-1 font-semibold text-amber-950 transition hover:bg-amber-400"
            >
              Restaurar esta versão
            </button>
          </div>
        )}
        {/* Overlay controls. Mobile (<lg): a single bottom sheet in flow — no
            loose absolutes over the canvas. Desktop (lg+): the sheet becomes
            display:contents and the two inner columns position themselves as
            narrow absolute flow-columns (left/right) that never overlap. */}
        {(positions || stl) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[60%] flex-row flex-wrap items-start gap-2 overflow-y-auto border-t border-slate-800 bg-slate-950/90 p-2 backdrop-blur lg:contents">
        {/* Left column: action toolbar + logo-position fieldset + paint panel,
            stacked in flow so they can never cover each other. */}
        <div className="contents lg:absolute lg:left-4 lg:top-[4.5rem] lg:z-10 lg:flex lg:max-h-[calc(100%-6rem)] lg:max-w-xs lg:flex-col lg:gap-2 lg:overflow-y-auto">
        <div className="flex flex-wrap gap-2">
          <DownloadStlButton iterationId={activeIterationId} stl={stl} />
          <FlexifyButton
            projectId={project.id}
            iterationId={iterationId}
            stl={stl}
            onFlexified={onResult}
          />
          {positions && importedBaseAvailable && (
            <button
              onClick={() => {
                setPickMode((v) => {
                  const next = !v
                  if (next) {
                    // Auto-size to ~65% of the face so monograms aren't tiny stamps.
                    setPlaceSizeMm(suggestedLogoSizeMm(positions))
                  }
                  return next
                })
                setPaintMode(false)
                setPick(null)
              }}
              disabled={!attachedImageUrl}
              className={`px-3 py-2 rounded-lg text-sm font-medium border shadow-soft min-h-11 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                pickMode
                  ? 'bg-orange-500 text-white border-orange-600'
                  : 'bg-slate-900/80 text-slate-100 border-slate-700 backdrop-blur hover:bg-slate-800'
              }`}
              title={
                attachedImageUrl
                  ? 'Clique num ponto do modelo para posicionar o logo ali'
                  : 'Anexe uma imagem de logo primeiro'
              }
            >
              📍 {pickMode ? 'Cancelar' : 'Logo aqui'}
            </button>
          )}
          {positions && paintableMeshAvailable && (
            <button
              onClick={() => {
                setPaintMode((v) => !v)
                setPickMode(false)
                setPick(null)
              }}
              disabled={placing}
              className={`px-3 py-2 rounded-lg text-sm font-medium border shadow-soft min-h-11 transition ${
                paintMode
                  ? 'bg-emerald-500 text-white border-emerald-600'
                  : 'bg-slate-900/80 text-slate-100 border-slate-700 backdrop-blur hover:bg-slate-800'
              }`}
              title="Clique no modelo para pintar (balde de região ou pincel)"
            >
              🎨 {paintMode ? 'Parar de pintar' : 'Pintar cores'}
            </button>
          )}
        </div>
        {paintMode && positions && (
          <div className="bg-emerald-950/90 backdrop-blur border border-emerald-700 rounded-xl p-3 text-xs shadow-card text-emerald-50 max-w-xs space-y-2">
            <p className="font-medium">Pintura manual (só no browser)</p>
            <p className="text-emerald-100/80">
              {paintTool === 'fill'
                ? 'Balde: preenche a região até as arestas do modelo. Roda no seu PC — o server não processa.'
                : 'Pincel: círculo ao redor do clique. Roda no seu PC — o server não processa.'}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPaintTool('fill')}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition ${
                  paintTool === 'fill'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800'
                }`}
              >
                🪣 Balde
              </button>
              <button
                type="button"
                onClick={() => setPaintTool('radius')}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition ${
                  paintTool === 'radius'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800'
                }`}
              >
                🖌️ Pincel
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPaintExtruder('A')}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition ${
                  paintExtruder === 'A'
                    ? 'bg-red-600 text-white'
                    : 'bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800'
                }`}
                title="Cor 1 (corpo)"
              >
                Cor 1 (A)
              </button>
              <button
                type="button"
                onClick={() => setPaintExtruder('B')}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition ${
                  paintExtruder === 'B'
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800'
                }`}
                title="Cor 2 (detalhe)"
              >
                Cor 2 (B)
              </button>
            </div>
            {paintTool === 'radius' && (
              <label className="flex items-center gap-2">
                Raio
                <input
                  type="range"
                  min={4}
                  max={40}
                  value={paintRadiusMm}
                  onChange={(e) => setPaintRadiusMm(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="tabular-nums w-10">{paintRadiusMm}mm</span>
              </label>
            )}
            {paintDirty && (
              <>
                <button
                  type="button"
                  onClick={() => void savePaint()}
                  disabled={placing}
                  className="w-full rounded-lg bg-emerald-500 px-2 py-2 font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  💾 Salvar pintura
                </button>
                <button
                  type="button"
                  onClick={() => void exportPainted3mf()}
                  disabled={placing}
                  className="w-full rounded-lg bg-white px-2 py-2 font-semibold text-emerald-950 hover:bg-emerald-50 disabled:opacity-50"
                >
                  ⬇ Exportar 3MF multi-cor
                </button>
              </>
            )}
            {placing && (
              <p className="text-emerald-200/90 animate-pulse">Pintando no worker…</p>
            )}
            {paintHint && !placing && (
              <p className="text-emerald-200/90">{paintHint}</p>
            )}
          </div>
        )}

        {/* Keyboard alternative to click-to-place: X/Y mm offsets from the mesh
            top-center, feeding the SAME placement handler as a canvas click.
            Shown only while pick mode is active so it never covers the toolbar. */}
        {pickMode && positions && importedBaseAvailable && (
          <fieldset className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl p-2 text-xs shadow-card text-slate-200">
            <legend className="px-1 text-slate-400">Posição do logo (teclado)</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                X (mm)
                <input
                  type="number"
                  value={logoX}
                  onChange={(e) => setLogoX(Number(e.target.value))}
                  aria-label="Deslocamento X do logo em milímetros"
                  className="border border-slate-600 bg-slate-800 text-slate-100 rounded px-2 min-h-11 w-20"
                />
              </label>
              <label className="flex items-center gap-1">
                Y (mm)
                <input
                  type="number"
                  value={logoY}
                  onChange={(e) => setLogoY(Number(e.target.value))}
                  aria-label="Deslocamento Y do logo em milímetros"
                  className="border border-slate-600 bg-slate-800 text-slate-100 rounded px-2 min-h-11 w-20"
                />
              </label>
              <button
                onClick={() => applyLogoPlacement(placementFromOffsets(logoX, logoY))}
                disabled={placing}
                className="min-h-11 px-3 rounded bg-orange-600 text-white disabled:opacity-60"
              >
                Aplicar posição
              </button>
            </div>
          </fieldset>
        )}

        {/* Click-to-place panel */}
        {pickMode && (
          <div className="bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl shadow-lift p-3 flex flex-wrap items-center gap-3 text-sm text-slate-200">
            {!pick ? (
              <span className="text-slate-300">👆 Clique no ponto do modelo onde quer o logo (arraste para girar)</span>
            ) : (
              <>
                <div className="flex rounded-lg border border-slate-600 overflow-hidden">
                  {(['embossed', 'engraved'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setPlaceTreatment(t)}
                      className={`px-2.5 py-1 transition ${placeTreatment === t ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      {t === 'embossed' ? 'Alto-relevo' : 'Gravado'}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1 text-slate-300">
                  Tamanho
                  <input
                    type="number"
                    min={10}
                    max={150}
                    step={1}
                    value={placeSizeMm}
                    onChange={(e) => setPlaceSizeMm(Math.max(10, Math.min(150, Number(e.target.value) || 40)))}
                    className="w-16 border border-slate-600 bg-slate-800 text-slate-100 rounded px-1 py-0.5"
                    aria-label="Tamanho do logo em milímetros (maior dimensão)"
                  />
                  mm
                </label>
                <button
                  onClick={() => applyLogoPlacement()}
                  disabled={placing}
                  className="px-3 py-2 rounded bg-orange-600 text-white font-medium min-h-11 disabled:opacity-60"
                >
                  {placing ? 'Aplicando…' : 'Aplicar logo'}
                </button>
                <button onClick={() => setPick(null)} className="text-slate-400 hover:text-white">
                  limpar
                </button>
              </>
            )}
          </div>
        )}

        </div>

        {/* Right column: print colors + slice, stacked in flow. */}
        <div className="contents lg:absolute lg:right-4 lg:top-4 lg:z-10 lg:flex lg:max-h-[calc(100%-6rem)] lg:max-w-xs lg:flex-col lg:items-end lg:gap-2 lg:overflow-y-auto">
        {/* Color configuration panel — only once a mesh is in the viewer */}
        {positions && (
        <div className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-card flex flex-col gap-2 text-xs text-slate-300">
          <div className="border-b border-slate-700 pb-1">
            <div className="font-semibold text-white">Cores da peça</div>
            <div className="text-[10px] text-slate-500">usadas no viewer e no 3MF exportado</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="body-color-picker"
              value={bodyColor}
              onChange={(e) => setBodyColor(e.target.value)}
              aria-label="Cor da base (extrusora A)"
              className="w-11 h-11 rounded border border-slate-600 cursor-pointer p-0"
            />
            <label htmlFor="body-color-picker" className="cursor-pointer font-medium">Cor da Base (A)</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="logo-color-picker"
              value={logoColor}
              onChange={(e) => setLogoColor(e.target.value)}
              aria-label="Cor do logo (extrusora B)"
              className="w-11 h-11 rounded border border-slate-600 cursor-pointer p-0"
            />
            <label htmlFor="logo-color-picker" className="cursor-pointer font-medium">
              Cor 2 / Logo (B)
            </label>
          </div>
          <p className="hidden lg:block text-[10px] text-slate-500 leading-snug max-w-[12rem]">
            Melhor: anexe o render de cores + &quot;pintar com a imagem&quot;. Ou use 🎨 Pintar cores no modelo.
          </p>
        </div>
        )}

        <SliceButton
          iterationId={activeIterationId}
          stl={stl}
          paintState={paintDirty ? 'dirty' : paintSaved ? 'saved' : null}
          multicolor={multicolorMesh}
        />
        </div>
        </div>
        )}

        {!error && <MeshValidityBanner report={validity} expectMultiBody={expectMultiBody} />}
        {/* Error alert. Mobile (<lg): top-anchored + z-20 so the bottom sheet
            (bottom-0 z-10, dynamic height) can never cover it. Desktop:
            bottom-4 as before (columns are top-anchored there). */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute top-4 left-4 right-4 z-20 lg:top-auto lg:bottom-4 bg-red-950/90 backdrop-blur text-red-100 border border-red-800 rounded-lg p-3 text-xs shadow-lift"
          >
            <strong>Erro:</strong> {error}
          </div>
        )}

        {!iterationId && !positions && !error && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <p className="text-sm text-slate-500">Seu modelo 3D aparece aqui</p>
          </div>
        )}
      </section>
    </main>
  )
}
