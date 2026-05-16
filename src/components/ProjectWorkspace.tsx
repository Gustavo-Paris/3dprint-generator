'use client'
import { useEffect, useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat, { type ChatResult } from './Chat'
import MeshViewer from './MeshViewer'
import SliceButton from './SliceButton'
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

  const [iterationId, setIterationId] = useState<string | null>(lastReady?.id ?? null)
  const [positions, setPositions] = useState<Float32Array | null>(null)
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
      const label = it.baseMode === 'with_base' ? 'Generated via Meshy (with trophy base)' : 'Generated via Meshy'
      return [
        userMsg,
        { role: 'assistant', text: label, iterationId: it.id, strategy: 'generative' },
      ]
    }
    return [userMsg]
  })

  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat projectId={project.id} initial={initialMessages} onResult={onResult} />
      </aside>
      <section className="relative bg-gray-50" data-testid="viewer-slot">
        <MeshViewer positions={positions} fitKey={iterationId ?? undefined} />
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
