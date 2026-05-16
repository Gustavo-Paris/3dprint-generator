'use client'
import { useEffect, useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat from './Chat'
import MeshViewer from './MeshViewer'
import SliceButton from './SliceButton'
import { runInWorker } from '@/lib/jscad/worker-client'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

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
  const [code, setCode] = useState<string | null>(lastReady?.jscadCode ?? null)
  const [iterationId, setIterationId] = useState<string | null>(lastReady?.id ?? null)
  const [positions, setPositions] = useState<Float32Array | null>(null)
  const [stl, setStl] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    setError(null)
    runInWorker({ type: 'jscad', code })
      .then((r) => {
        if (cancelled) return
        if (r.ok) {
          setPositions(r.positions)
          setStl(r.stl)
        } else {
          setPositions(null)
          setStl(null)
          setError(r.error)
        }
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [code])

  const initialMessages = initialHistory.flatMap((it) => {
    const out: { role: 'user' | 'assistant'; text: string; iterationId?: string }[] = [
      { role: 'user', text: it.userMessage },
    ]
    if (it.jscadCode) out.push({ role: 'assistant', text: it.jscadCode, iterationId: it.id })
    return out
  })

  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          onIterationReady={(id, c) => {
            setIterationId(id)
            setCode(c)
          }}
        />
      </aside>
      <section className="relative bg-gray-50" data-testid="viewer-slot">
        <MeshViewer positions={positions} />
        <SliceButton iterationId={iterationId} stl={stl} />
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-50 text-red-900 border border-red-200 rounded p-3 text-xs">
            <strong>JSCAD error:</strong> {error}
          </div>
        )}
      </section>
    </main>
  )
}
