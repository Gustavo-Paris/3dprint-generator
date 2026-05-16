---
uid: task-016
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

# Chat client component

**Files:** `src/components/Chat.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Chat component**

`src/components/Chat.tsx`:

```tsx
'use client'
import { useState } from 'react'

type Msg = { role: 'user' | 'assistant'; text: string; iterationId?: string }

export default function Chat({
  projectId,
  initial,
  onIterationReady,
}: {
  projectId: string
  initial: Msg[]
  onIterationReady: (iterationId: string, code: string) => void
}) {
  const [messages, setMessages] = useState<Msg[]>(initial)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!draft.trim() || busy) return
    const userText = draft.trim()
    setMessages((m) => [...m, { role: 'user', text: userText }])
    setDraft('')
    setBusy(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, message: userText }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const iterationId = res.headers.get('x-iteration-id') ?? undefined
      const text = await res.text()
      setMessages((m) => [...m, { role: 'assistant', text, iterationId }])
      if (iterationId) onIterationReady(iterationId, text)
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm" data-testid="chat-history">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block rounded px-3 py-2 max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-black text-white'
                  : 'bg-gray-100 font-mono text-xs whitespace-pre-wrap'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="text-gray-400 text-xs">Generating…</div>}
      </div>
      <form
        className="p-4 border-t flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe what to build..."
          className="flex-1 border rounded px-3 py-2"
          disabled={busy}
          data-testid="chat-input"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
          disabled={busy}
        >
          Send
        </button>
      </form>
    </>
  )
}
```

- [ ] **Step 2: Wire into workspace (temporary text-only viewer)**

Replace `src/components/ProjectWorkspace.tsx`:

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(chat): wire chat → /api/generate → workspace"
```
