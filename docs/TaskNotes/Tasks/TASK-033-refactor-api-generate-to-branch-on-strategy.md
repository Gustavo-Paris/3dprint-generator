---
uid: task-033
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-05-16
pomodoros: 0
contexts:
- phase:6
- meshy
- hybrid
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Refactor `/api/generate` to branch on strategy

**Files:** `src/app/api/generate/route.ts`

- [ ] **Step 1: Rewrite the route**

Replace `src/app/api/generate/route.ts` entirely:

```ts
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { buildMessages } from '@/lib/prompt/build'
import { classifyIntent } from '@/lib/prompt/classify'
import { getModel } from '@/lib/llm/model'
import { generateMesh } from '@/lib/meshy/client'
import { generateText, streamText } from 'ai'
import { put } from '@vercel/blob'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 300

const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
})

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

  // Classify intent first (cheap haiku call). Generative path needs MESHY_API_KEY;
  // if missing, fall back to parametric and let the LLM make its best attempt.
  let strategy: 'parametric' | 'generative' = await classifyIntent(message)
  if (strategy === 'generative' && !process.env.MESHY_API_KEY) strategy = 'parametric'

  const [iteration] = await db
    .insert(iterations)
    .values({ projectId, userMessage: message, status: 'generating', strategy })
    .returning()

  if (strategy === 'generative') {
    // Generative path: call Meshy, wait, return JSON with mesh URL.
    const result = await generateMesh({
      prompt: message,
      apiKey: process.env.MESHY_API_KEY!,
    })
    if (!result.ok) {
      await db.update(iterations)
        .set({ status: 'failed', error: result.error })
        .where(eq(iterations.id, iteration.id))
      return Response.json({ error: result.error, iteration_id: iteration.id }, { status: 502 })
    }

    let meshUrl: string | null = null
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const filename = `${session.user.id}/${projectId}/${iteration.id}.stl`
      const blob = await put(filename, Buffer.from(result.stl), { access: 'public', addRandomSuffix: false })
      meshUrl = blob.url
    }

    await db.update(iterations)
      .set({ status: 'ready', meshBlobUrl: meshUrl })
      .where(eq(iterations.id, iteration.id))
    await db.update(projects)
      .set({ currentIterationId: iteration.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    return Response.json({
      strategy: 'generative',
      iteration_id: iteration.id,
      mesh_url: meshUrl,
      mesh_base64: meshUrl ? null : Buffer.from(result.stl).toString('base64'),
      meta: result.meta,
    })
  }

  // Parametric path: existing JSCAD generation, but return JSON instead of streaming.
  const { system, messages } = buildMessages({
    history: history
      .filter((h) => h.strategy === 'parametric')
      .map((h) => ({ userMessage: h.userMessage, jscadCode: h.jscadCode })),
    newMessage: message,
  })

  const { text } = await generateText({
    model: getModel(),
    system,
    messages,
    maxOutputTokens: 4096,
  })

  await db.update(iterations)
    .set({ jscadCode: text, status: 'ready' })
    .where(eq(iterations.id, iteration.id))
  await db.update(projects)
    .set({ currentIterationId: iteration.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId))

  return Response.json({
    strategy: 'parametric',
    iteration_id: iteration.id,
    jscad_code: text,
  })
}
```

Note: this trades streaming for simpler JSON. Streaming UX can come back in Phase 7 if it matters.

- [ ] **Step 2: Update integration test**

The existing `tests/integration/api-generate.test.ts` mocks `streamText`. The route now uses `generateText` (no streaming). Update the test to mock `generateText` and also mock `@/lib/prompt/classify` to return `parametric`:

```ts
vi.mock('@/lib/prompt/classify', () => ({
  classifyIntent: vi.fn().mockResolvedValue('parametric'),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })\nmodule.exports = { main }`,
    }),
  }
})
```

The assertions change:
- Response is `application/json`, parse it
- Expect `body.strategy === 'parametric'` and `body.jscad_code.includes('cuboid')`

- [ ] **Step 3: Run**

```bash
pnpm test tests/integration/api-generate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/generate/route.ts tests/integration/api-generate.test.ts
git commit -m "feat(api): branch /api/generate on parametric/generative strategy"
```
