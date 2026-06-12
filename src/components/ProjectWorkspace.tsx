'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
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
      className="absolute inset-0 flex items-center justify-center bg-gray-50 text-gray-400 text-sm"
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

  async function applyLogoPlacement() {
    if (!pick) return
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
            point: pick.point,
            normal: pick.normal,
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
    <main className="h-screen flex flex-col lg:grid lg:grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0 max-h-[45vh] lg:max-h-none">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
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
      <section className="relative bg-gray-50 flex-1 min-h-0" data-testid="viewer-slot">
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
              className={`px-3 py-2 rounded text-sm font-medium border shadow-sm min-h-11 ${
                pickMode
                  ? 'bg-orange-600 text-white border-orange-700'
                  : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
              }`}
              title="Clique num ponto do modelo para posicionar o logo ali"
            >
              📍 {pickMode ? 'Cancelar' : 'Logo aqui'}
            </button>
          )}
        </div>

        {/* Click-to-place panel */}
        {pickMode && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex items-center gap-3 text-sm">
            {!pick ? (
              <span className="text-gray-600">👆 Clique no ponto do modelo onde quer o logo (arraste para girar)</span>
            ) : (
              <>
                <div className="flex rounded border border-gray-300 overflow-hidden">
                  {(['embossed', 'engraved'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setPlaceTreatment(t)}
                      className={`px-2.5 py-1 ${placeTreatment === t ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                    >
                      {t === 'embossed' ? 'Alto-relevo' : 'Gravado'}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1 text-gray-700">
                  Tamanho
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={placeSizeMm}
                    onChange={(e) => setPlaceSizeMm(Math.max(5, Math.min(60, Number(e.target.value) || 20)))}
                    className="w-14 border border-gray-300 rounded px-1 py-0.5"
                  />
                  mm
                </label>
                <button
                  onClick={applyLogoPlacement}
                  disabled={placing}
                  className="px-3 py-2 rounded bg-orange-600 text-white font-medium min-h-11 disabled:opacity-60"
                >
                  {placing ? 'Aplicando…' : 'Aplicar logo'}
                </button>
                <button onClick={() => setPick(null)} className="text-gray-500 hover:text-gray-800">
                  limpar
                </button>
              </>
            )}
          </div>
        )}

        {/* Color configuration panel */}
        <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3 shadow-sm flex flex-col gap-2 text-xs text-gray-700">
          <div className="font-semibold text-gray-900 border-b pb-1">Cores de Impressão</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="body-color-picker"
              value={bodyColor}
              onChange={(e) => setBodyColor(e.target.value)}
              aria-label="Cor da base (extrusora A)"
              className="w-11 h-11 rounded border border-gray-300 cursor-pointer p-0"
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
              className="w-11 h-11 rounded border border-gray-300 cursor-pointer p-0"
            />
            <label htmlFor="logo-color-picker" className="cursor-pointer font-medium">Cor do Logo (B)</label>
          </div>
        </div>

        <SliceButton iterationId={iterationId} stl={stl} />
        {!error && <MeshValidityBanner report={validity} />}
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-50 text-red-900 border border-red-200 rounded p-3 text-xs">
            <strong>Error:</strong> {error}
          </div>
        )}
      </section>
    </main>
  )
}
