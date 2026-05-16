---
uid: task-011
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Project detail page shell

**Files:** `src/app/projects/[id]/page.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Page server component**

`src/app/projects/[id]/page.tsx`:

```tsx
import { auth } from '@/auth'
import { db } from '@/db'
import { projects, iterations } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import ProjectWorkspace from '@/components/ProjectWorkspace'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return null

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) notFound()

  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, project.id))
    .orderBy(asc(iterations.createdAt))

  return <ProjectWorkspace project={project} initialHistory={history} />
}
```

- [ ] **Step 2: Workspace skeleton**

`src/components/ProjectWorkspace.tsx`:

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add src/app/projects/ src/components/ProjectWorkspace.tsx
git commit -m "feat(projects): detail page shell"
```
