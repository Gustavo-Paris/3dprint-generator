---
uid: task-014
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

# `/api/generate` — streaming, persisted

**Files:** `src/app/api/generate/route.ts`

- [ ] **Step 1: Implement**

`src/app/api/generate/route.ts`:

```ts
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { buildMessages } from '@/lib/prompt/build'
import { streamText } from 'ai'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 120

const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
})

const MODEL = 'anthropic/claude-opus-4-7'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { projectId, message } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return new Response('Not found', { status: 404 })

  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  const [iteration] = await db
    .insert(iterations)
    .values({ projectId, userMessage: message, status: 'generating' })
    .returning()

  const messages = buildMessages({
    history: history.map((h) => ({ userMessage: h.userMessage, jscadCode: h.jscadCode })),
    newMessage: message,
  })

  const result = streamText({
    model: MODEL,
    messages,
    onFinish: async ({ text }) => {
      await db
        .update(iterations)
        .set({ jscadCode: text, status: 'ready' })
        .where(eq(iterations.id, iteration.id))
      await db
        .update(projects)
        .set({ currentIterationId: iteration.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
    },
    onError: async ({ error }) => {
      await db
        .update(iterations)
        .set({ status: 'failed', error: String(error) })
        .where(eq(iterations.id, iteration.id))
    },
  })

  const response = result.toTextStreamResponse()
  response.headers.set('x-iteration-id', iteration.id)
  return response
}
```

The AI SDK auto-reads `AI_GATEWAY_API_KEY`; falls back to `ANTHROPIC_API_KEY` when not present.

- [ ] **Step 2: Commit (test next)**

```bash
git add src/app/api/generate/route.ts
git commit -m "feat(api): /api/generate streams Claude → persists iteration"
```
