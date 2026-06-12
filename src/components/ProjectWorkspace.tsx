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
import { runInWorker } from '@/lib/jscad/worker-client'
import type { MeshValidityReport } from '@/lib/mesh/validity'

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
    if (it.strategy === 'generative') {
      return [userMsg, {
        role: 'assistant' as const,
        text: 'Pronto',
        iterationId: it.id,
        strategy: 'generative' as const,
        status: it.status,
        design: it.validationReport ?? undefined,
      }]
    }
    return [userMsg]
  })
}

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: HistoryRow[]
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

  // 3MF import flow: track the pending mesh URL + captured previews.
  const meshViewerRef = useRef<MeshViewerHandle>(null)
  const [pendingMeshUrl, setPendingMeshUrl] = useState<string | null>(null)
  const [pendingPreviews, setPendingPreviews] = useState<PreviewBundle | null>(null)

  // Hydrate viewer from last ready iteration on mount.
  useEffect(() => {
    if (!lastReady) return
    let cancelled = false
    ;(async () => {
      try {
        setError(null)
        setValidity(null)
        if (lastReady.strategy === 'parametric' && lastReady.jscadCode) {
          const r = await runInWorker({ type: 'jscad', code: lastReady.jscadCode })
          if (cancelled) return
          if (r.ok) {
            setPositions(r.positions)
            setStl(r.stl)
            setBodies(r.bodies)
            setValidity(r.validity ?? null)
          } else setError(r.error)
        } else if (lastReady.strategy === 'generative' && lastReady.meshBlobUrl) {
          const res = await fetch(lastReady.meshBlobUrl)
          if (!res.ok) throw new Error(`Mesh fetch ${res.status}`)
          const bytes = new Uint8Array(await res.arrayBuffer())
          const r = await runInWorker({ type: 'stl', stl: bytes })
          if (cancelled) return
          if (r.ok) {
            setPositions(r.positions)
            setStl(bytes)
            setBodies(r.bodies)
            setValidity(r.validity ?? null)
          } else setError(r.error)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
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
      if (!res.ok) throw new Error(`Mesh fetch ${res.status}`)
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
      setError(String(e))
    }
  }

  async function onResult(r: ChatResult) {
    setIterationId(r.iterationId)
    setError(null)
    setValidity(null)
    // After the first successful generate with a pending mesh, clear the pending
    // state — the server has now cached the faces and previews in the iteration.
    if (pendingMeshUrl) {
      setPendingMeshUrl(null)
      setPendingPreviews(null)
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
          if (!res.ok) throw new Error(`Mesh fetch ${res.status}`)
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
      setError(String(e))
    }
  }

  const initialMessages: ChatMsg[] = mapHistoryToMessages(initialHistory)
  const importedBaseAvailable = hasImportedBase(initialHistory, pendingMeshUrl)

  const [bodyColor, setBodyColor] = useState('#3b82f6')
  const [logoColor, setLogoColor] = useState('#f8fafc')

  // Click-to-place logo: toggle pick mode, capture the picked point + normal,
  // then POST it as a logoPlacement (no LLM, lands exactly where clicked).
  const [pickMode, setPickMode] = useState(false)
  const [pick, setPick] = useState<{
    point: [number, number, number]
    normal: [number, number, number]
  } | null>(null)
  const [placeTreatment, setPlaceTreatment] = useState<'embossed' | 'engraved'>('embossed')
  const [placeSizeMm, setPlaceSizeMm] = useState(20)
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
        body: JSON.stringify({
          projectId: project.id,
          message: `logo ${placeTreatment === 'engraved' ? 'gravado' : 'em relevo'} (posicionado no viewer)`,
          logoPlacement: {
            point: p.point,
            normal: p.normal,
            treatment: placeTreatment,
            sizeMm: placeSizeMm,
            depthMm: placeTreatment === 'engraved' ? 1.0 : 1.2,
          },
        }),
      })
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
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
      setError(String(e))
    } finally {
      setPlacing(false)
    }
  }

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
          pendingMeshUrl={pendingMeshUrl}
          pendingPreviews={pendingPreviews}
        />
      </aside>
      <section className="relative studio-stage flex-1 min-h-0" data-testid="viewer-slot">
        <MeshViewer
          ref={meshViewerRef}
          positions={positions}
          bodies={bodies}
          fitKey={iterationId ?? undefined}
          bodyColor={bodyColor}
          logoColor={logoColor}
          pickMode={pickMode}
          onPick={(point, normal) => setPick({ point, normal })}
          pickMarker={pick?.point ?? null}
          loading={!!iterationId && positions === null && !error}
        />
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <DownloadStlButton iterationId={iterationId} stl={stl} />
          <FlexifyButton
            projectId={project.id}
            iterationId={iterationId}
            stl={stl}
            onFlexified={onResult}
          />
          {positions && importedBaseAvailable && (
            <button
              onClick={() => { setPickMode((v) => !v); setPick(null) }}
              className={`px-3 py-2 rounded-lg text-sm font-medium border shadow-soft min-h-11 transition ${
                pickMode
                  ? 'bg-orange-500 text-white border-orange-600'
                  : 'bg-slate-900/80 text-slate-100 border-slate-700 backdrop-blur hover:bg-slate-800'
              }`}
              title="Clique num ponto do modelo para posicionar o logo ali"
            >
              📍 {pickMode ? 'Cancelar' : 'Logo aqui'}
            </button>
          )}
        </div>

        {/* Keyboard alternative to click-to-place: X/Y mm offsets from the mesh
            top-center, feeding the SAME placement handler as a canvas click. */}
        {positions && importedBaseAvailable && (
          <fieldset className="absolute top-[4.5rem] left-4 z-10 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl p-2 text-xs shadow-card text-slate-200">
            <legend className="px-1 text-slate-400">Posição do logo (teclado)</legend>
            <div className="flex items-center gap-2">
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
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl shadow-lift p-3 flex items-center gap-3 text-sm text-slate-200">
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
                    min={5}
                    max={60}
                    value={placeSizeMm}
                    onChange={(e) => setPlaceSizeMm(Math.max(5, Math.min(60, Number(e.target.value) || 20)))}
                    className="w-14 border border-slate-600 bg-slate-800 text-slate-100 rounded px-1 py-0.5"
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

        {/* Color configuration panel */}
        <div className="absolute top-4 right-4 z-10 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-card flex flex-col gap-2 text-xs text-slate-300">
          <div className="font-semibold text-white border-b border-slate-700 pb-1">Cores de Impressão</div>
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
            <label htmlFor="logo-color-picker" className="cursor-pointer font-medium">Cor do Logo (B)</label>
          </div>
        </div>

        <SliceButton iterationId={iterationId} stl={stl} />
        {!error && <MeshValidityBanner report={validity} />}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute bottom-4 left-4 right-4 bg-red-950/90 backdrop-blur text-red-100 border border-red-800 rounded-lg p-3 text-xs shadow-lift"
          >
            <strong>Erro:</strong> {error}
          </div>
        )}
      </section>
    </main>
  )
}
