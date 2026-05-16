'use client'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
}) {
  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-4 text-sm text-gray-500" data-testid="chat-history">
          {initialHistory.length === 0
            ? 'Describe what you want to print.'
            : `${initialHistory.length} iterations so far.`}
        </div>
        <div className="p-4 border-t" data-testid="chat-input-placeholder">
          (chat input — Task 16)
        </div>
      </aside>
      <section className="bg-gray-50 flex items-center justify-center text-gray-400" data-testid="viewer-slot">
        (3D viewer — Task 18)
      </section>
    </main>
  )
}
