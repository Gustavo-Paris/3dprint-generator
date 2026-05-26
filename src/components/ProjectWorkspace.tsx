'use client'
import { useEffect, useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat, { type ChatResult } from './Chat'
import MeshViewer, { type MeshBody } from './MeshViewer'
import SliceButton from './SliceButton'
import DownloadStlButton from './DownloadStlButton'
import { runInWorker } from '@/lib/jscad/worker-client'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

type ChatMsg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
  imageUrl?: string
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
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

  // Hydrate viewer from last ready iteration on mount.
  useEffect(() => {
    if (!lastReady) return
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        if (lastReady.strategy === 'parametric' && lastReady.jscadCode) {
          const r = await runInWorker({ type: 'jscad', code: lastReady.jscadCode })
          if (cancelled) return
          if (r.ok) {
            setPositions(r.positions)
            setStl(r.stl)
            setBodies(r.bodies)
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

  async function onResult(r: ChatResult) {
    setIterationId(r.iterationId)
    setError(null)
    try {
      if (r.kind === 'parametric') {
        const result = await runInWorker({ type: 'jscad', code: r.code })
        if (result.ok) {
          setPositions(result.positions)
          setStl(result.stl)
          setBodies(result.bodies)
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
        } else setError(result.error)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const initialMessages: ChatMsg[] = initialHistory.flatMap((it) => {
    const userMsg: ChatMsg = {
      role: 'user',
      text: it.userMessage,
      imageUrl: it.imageBlobUrl ?? undefined,
    }
    if (it.strategy === 'parametric' && it.jscadCode) {
      return [
        userMsg,
        { role: 'assistant', text: it.jscadCode, iterationId: it.id, strategy: 'parametric' },
      ]
    }
    if (it.strategy === 'generative') {
      // validationReport now holds the parsed Design JSON (the schema the LLM
      // emitted). Surfaces in the chat as a collapsible "Design interpretado"
      // block so the user can see exactly what the LLM picked and iterate.
      const design = it.validationReport ?? undefined
      const label = 'Generated'
      return [
        userMsg,
        {
          role: 'assistant',
          text: label,
          iterationId: it.id,
          strategy: 'generative',
          design,
        },
      ]
    }
    return [userMsg]
  })

  const [bodyColor, setBodyColor] = useState('#3b82f6')
  const [logoColor, setLogoColor] = useState('#f8fafc')

  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          initialAttachedImageUrl={lastImageUrl}
          onResult={onResult}
        />
      </aside>
      <section className="relative bg-gray-50" data-testid="viewer-slot">
        <MeshViewer
          positions={positions}
          bodies={bodies}
          fitKey={iterationId ?? undefined}
          bodyColor={bodyColor}
          logoColor={logoColor}
        />
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <DownloadStlButton iterationId={iterationId} stl={stl} />
        </div>

        {/* Color configuration panel */}
        <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3 shadow-sm flex flex-col gap-2 text-xs text-gray-700">
          <div className="font-semibold text-gray-900 border-b pb-1">Cores de Impressão</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="body-color-picker"
              value={bodyColor}
              onChange={(e) => setBodyColor(e.target.value)}
              className="w-6 h-6 rounded border border-gray-300 cursor-pointer"
            />
            <label htmlFor="body-color-picker" className="cursor-pointer font-medium">Cor da Base (A)</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="logo-color-picker"
              value={logoColor}
              onChange={(e) => setLogoColor(e.target.value)}
              className="w-6 h-6 rounded border border-gray-300 cursor-pointer"
            />
            <label htmlFor="logo-color-picker" className="cursor-pointer font-medium">Cor do Logo (B)</label>
          </div>
        </div>

        <SliceButton iterationId={iterationId} stl={stl} />
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-50 text-red-900 border border-red-200 rounded p-3 text-xs">
            <strong>Error:</strong> {error}
          </div>
        )}
      </section>
    </main>
  )
}
