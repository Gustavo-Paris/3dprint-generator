'use client'
import { useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat from './Chat'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
}) {
  const [currentCode, setCurrentCode] = useState<string | null>(
    initialHistory.findLast((it) => it.status === 'ready')?.jscadCode ?? null,
  )

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
          onIterationReady={(_id, code) => setCurrentCode(code)}
        />
      </aside>
      <section className="bg-gray-50 flex items-center justify-center text-gray-400" data-testid="viewer-slot">
        {currentCode ? <pre className="text-[10px] text-left p-4">{currentCode}</pre> : '(viewer — Task 18)'}
      </section>
    </main>
  )
}
