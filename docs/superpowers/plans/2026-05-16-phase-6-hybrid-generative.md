# Phase 6 — Hybrid JSCAD + Meshy Generative

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Add a generative-3D path alongside JSCAD so figurative/organic requests (Iron Man helmet, miniatures, sculptures) work. LLM classifies the request as `parametric` (JSCAD path, existing) or `generative` (Meshy.ai API, new). Both paths land in the same viewer + slicer flow.

**Trade-off (locked-in):** generative requests don't iterate via chat the way JSCAD does — each follow-up is a fresh generation, not a tweak. We accept that and surface it in the UI ("This was generated; edit the description and re-send to try again").

**Architecture:**

```
User message (+ optional image)
  → /api/generate
       ↓
     Intent classifier (Claude Haiku, 1 token) → 'p' | 'g'
       ↓ ↓
   parametric          generative
       ↓                   ↓
   Claude 4.7         Meshy POST text-to-3d
   → JSCAD code       → task_id
   (existing path)    → poll GET task_id every 4s
                      → SUCCEEDED → download .stl
                      → store STL in Vercel Blob (or inline)
       ↓                   ↓
                  Both write iteration with:
                  - strategy: 'parametric' | 'generative'
                  - jscad_code (parametric only)
                  - mesh_blob_url (generative only)
                  - sliced cols (filled later by /api/slice)
       ↓                   ↓
   Browser worker:    Browser worker:
   eval JSCAD →       parse STL bytes →
   positions+STL      positions
       ↓                   ↓
              Same viewer / SliceButton / 3MF download
```

**Tech Stack:** Meshy.ai REST API v2, Claude Haiku 4.5 for classification, existing AI Gateway/Anthropic provider, STL binary parser in worker, JSON response from `/api/generate` (was text/plain).

**Out of scope:**
- Image input to Meshy (text-only this phase; image-to-3d is Phase 7)
- Streaming generative status (just spinner + "estimated 60s")
- Cost tracking / quota UI
- Letting user override the classifier ("force generative")
- Multi-stage Meshy (preview then refine) — single-stage refine only

**Out-of-band setup:**
- User signs up at https://meshy.ai and creates an API key
- `MESHY_API_KEY="msy_..."` in `.env.local`

---

## File Structure

```
3dprint-generator/
├── drizzle/<new migration>           # MODIFY: add strategy + mesh_blob_url cols
├── src/
│   ├── env.ts                        # MODIFY: MESHY_API_KEY (optional)
│   ├── db/schema.ts                  # MODIFY: iterations cols
│   ├── lib/
│   │   ├── meshy/
│   │   │   ├── client.ts             # NEW: REST wrapper (text-to-3d + poll + fetch mesh)
│   │   │   └── types.ts              # NEW: shared types
│   │   ├── prompt/
│   │   │   └── classify.ts           # NEW: intent classifier prompt + call
│   │   └── jscad/
│   │       ├── runner.ts             # MODIFY: accept either `code` or `stl` input
│   │       ├── worker-entry.ts       # MODIFY: branch on message type
│   │       └── worker-client.ts      # MODIFY: runInWorker accepts { code? | stl? }
│   ├── app/api/generate/route.ts     # MODIFY: branch on classifier
│   └── components/
│       ├── Chat.tsx                  # MODIFY: parse JSON response, render strategy badge
│       └── ProjectWorkspace.tsx      # MODIFY: handle mesh_blob_url path
└── tests/
    ├── unit/
    │   ├── meshy-client.test.ts      # NEW: mocked
    │   ├── classifier.test.ts        # NEW
    │   └── stl-parser.test.ts        # NEW
    └── e2e/
        └── generative-flow.spec.ts   # NEW: mocked Meshy
```

---

## Task 1: Schema migration — strategy + mesh url

**Files:** `src/db/schema.ts`, generated migration

- [ ] **Step 1: Extend iterations**

In `src/db/schema.ts`, add two columns to `iterations`:

```ts
  strategy: text('strategy', { enum: ['parametric', 'generative'] })
    .notNull()
    .default('parametric'),
  meshBlobUrl: text('mesh_blob_url'),
```

`jscadCode` stays nullable (already is). For generative iterations it'll be null, for parametric it's the code.

- [ ] **Step 2: Generate + migrate**

```bash
pnpm db:generate
pnpm db:migrate
docker exec 3dgen-postgres psql -U app -d app -c "\d iterations" | grep -E "strategy|mesh_blob"
```

Expect both new columns to appear.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add strategy + mesh_blob_url to iterations"
```

---

## Task 2: Meshy.ai REST client

**Files:** `src/lib/meshy/types.ts`, `src/lib/meshy/client.ts`, `src/env.ts`, `.env.example`, `tests/unit/meshy-client.test.ts`

- [ ] **Step 1: Env**

In `src/env.ts` extend the schema:

```ts
  MESHY_API_KEY: z.string().optional(),
```

Append to `.env.example`:

```
# Meshy.ai (Phase 6) — text-to-3D for figurative / organic requests.
# Get a key at https://meshy.ai → Settings → API Keys.
MESHY_API_KEY=""
```

- [ ] **Step 2: Types** — `src/lib/meshy/types.ts`

```ts
export type MeshyStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELED'

export type MeshyTask = {
  id: string
  status: MeshyStatus
  progress: number
  task_error?: { message: string }
  model_urls?: {
    glb?: string
    fbx?: string
    obj?: string
    usdz?: string
    blend?: string
  }
}

export type MeshyResult = {
  ok: true
  stl: Uint8Array
  meta: { task_id: string; took_ms: number }
} | {
  ok: false
  error: string
}
```

Note: Meshy v2 doesn't always return STL natively — OBJ is the most reliable. We'll convert OBJ→STL in Task 3 step 4 if needed. Confirm by reading Meshy docs at impl time; some plans include STL directly, others require OBJ→STL conversion in our code.

- [ ] **Step 3: Failing test**

`tests/unit/meshy-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateMesh } from '@/lib/meshy/client'

const ORIGINAL_FETCH = global.fetch

describe('generateMesh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('polls until SUCCEEDED and downloads the mesh', async () => {
    const calls: string[] = []
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/openapi/v2/text-to-3d') && init?.method === 'POST') {
        return new Response(JSON.stringify({ result: 'task_123' }), { status: 200 })
      }
      if (url.endsWith('/openapi/v2/text-to-3d/task_123')) {
        const n = calls.filter((c) => c.includes('GET /openapi/v2/text-to-3d/task_123')).length
        if (n < 2) {
          return new Response(
            JSON.stringify({ id: 'task_123', status: 'IN_PROGRESS', progress: 50 }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            id: 'task_123',
            status: 'SUCCEEDED',
            progress: 100,
            model_urls: { obj: 'https://meshy.example/task_123.obj' },
          }),
          { status: 200 },
        )
      }
      if (url === 'https://meshy.example/task_123.obj') {
        // Minimal OBJ: 1 triangle
        return new Response('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof global.fetch

    const promise = generateMesh({ prompt: 'iron man helmet', apiKey: 'msy_test' })
    await vi.runAllTimersAsync()
    const r = await promise

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.stl.byteLength).toBe(84 + 50) // 1 triangle binary STL
      expect(r.meta.task_id).toBe('task_123')
    }
    global.fetch = ORIGINAL_FETCH
  })
})
```

- [ ] **Step 4: Implement client** — `src/lib/meshy/client.ts`

```ts
import type { MeshyTask, MeshyResult } from './types'

const BASE = 'https://api.meshy.ai/openapi/v2'
const POLL_INTERVAL_MS = 4000
const TIMEOUT_MS = 180_000

/**
 * Generate a 3D mesh from a text prompt using Meshy.ai. Polls until done,
 * downloads the OBJ result, converts to binary STL, returns bytes.
 */
export async function generateMesh(input: {
  prompt: string
  apiKey: string
}): Promise<MeshyResult> {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    'content-type': 'application/json',
  }

  const t0 = Date.now()

  // 1. Create task
  const createRes = await fetch(`${BASE}/text-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'preview', // 'refine' takes ~5x longer; preview is good enough for v1
      prompt: input.prompt,
      art_style: 'realistic',
      should_remesh: true,
      negative_prompt: 'low poly, blurry',
    }),
  })
  if (!createRes.ok) {
    return { ok: false, error: `Meshy create ${createRes.status}: ${await createRes.text().catch(() => '')}` }
  }
  const { result: taskId } = (await createRes.json()) as { result: string }

  // 2. Poll
  while (Date.now() - t0 < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const statusRes = await fetch(`${BASE}/text-to-3d/${taskId}`, { headers })
    if (!statusRes.ok) {
      return { ok: false, error: `Meshy poll ${statusRes.status}` }
    }
    const task = (await statusRes.json()) as MeshyTask
    if (task.status === 'SUCCEEDED') {
      const objUrl = task.model_urls?.obj
      if (!objUrl) return { ok: false, error: 'Meshy returned no .obj model_url' }

      // 3. Download OBJ
      const objRes = await fetch(objUrl)
      if (!objRes.ok) return { ok: false, error: `Meshy mesh download ${objRes.status}` }
      const objText = await objRes.text()

      // 4. Convert OBJ → binary STL
      const stl = objToBinarySTL(objText)
      return { ok: true, stl, meta: { task_id: taskId, took_ms: Date.now() - t0 } }
    }
    if (task.status === 'FAILED' || task.status === 'EXPIRED' || task.status === 'CANCELED') {
      return { ok: false, error: `Meshy ${task.status}: ${task.task_error?.message ?? 'unknown'}` }
    }
    // PENDING / IN_PROGRESS — keep polling
  }
  return { ok: false, error: `Meshy timeout after ${TIMEOUT_MS / 1000}s` }
}

/**
 * Minimal OBJ → binary STL converter. Handles `v x y z` and `f a b c [d]` lines.
 * Quads are fan-triangulated. Texture/normal indices are stripped from face refs
 * (`1/2/3` → `1`). No support for negative indices, smoothing groups, or `g` groups
 * beyond ignoring them.
 */
export function objToBinarySTL(obj: string): Uint8Array {
  const verts: [number, number, number][] = []
  const tris: [number, number, number][] = []

  for (const line of obj.split('\n')) {
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/)
      verts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])])
    } else if (line.startsWith('f ')) {
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((p) => parseInt(p.split('/')[0], 10) - 1)
      // Fan triangulate
      for (let i = 1; i < idx.length - 1; i++) {
        tris.push([idx[0], idx[i], idx[i + 1]])
      }
    }
  }

  const buf = new ArrayBuffer(84 + 50 * tris.length)
  const dv = new DataView(buf)
  dv.setUint32(80, tris.length, true)
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i]
    const va = verts[a], vb = verts[b], vc = verts[c]
    const base = 84 + i * 50

    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2]
    const wx = vc[0] - va[0], wy = vc[1] - va[1], wz = vc[2] - va[2]
    let nx = uy * wz - uz * wy
    let ny = uz * wx - ux * wz
    let nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    dv.setFloat32(base, nx, true)
    dv.setFloat32(base + 4, ny, true)
    dv.setFloat32(base + 8, nz, true)
    dv.setFloat32(base + 12, va[0], true); dv.setFloat32(base + 16, va[1], true); dv.setFloat32(base + 20, va[2], true)
    dv.setFloat32(base + 24, vb[0], true); dv.setFloat32(base + 28, vb[1], true); dv.setFloat32(base + 32, vb[2], true)
    dv.setFloat32(base + 36, vc[0], true); dv.setFloat32(base + 40, vc[1], true); dv.setFloat32(base + 44, vc[2], true)
    dv.setUint16(base + 48, 0, true)
  }
  return new Uint8Array(buf)
}
```

- [ ] **Step 5: Run, expect 1 passed**

```bash
pnpm test tests/unit/meshy-client.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/meshy/ src/env.ts .env.example tests/unit/meshy-client.test.ts
git commit -m "feat(meshy): REST client + OBJ→STL conversion"
```

---

## Task 3: Intent classifier

**Files:** `src/lib/prompt/classify.ts`, `tests/unit/classifier.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/classifier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { classifyIntent } from '@/lib/prompt/classify'

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { generateText } from 'ai'

vi.mock('@/lib/llm/model', () => ({
  getClassifierModel: () => 'mocked-model',
}))

describe('classifyIntent', () => {
  it('returns "generative" when classifier responds with g', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'g' })
    const r = await classifyIntent('iron man helmet real size')
    expect(r).toBe('generative')
  })

  it('returns "parametric" when classifier responds with p', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'p' })
    const r = await classifyIntent('a 40mm cube with a 10mm hole')
    expect(r).toBe('parametric')
  })

  it('defaults to parametric on ambiguous output', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'maybe both?' })
    const r = await classifyIntent('something weird')
    expect(r).toBe('parametric')
  })
})
```

- [ ] **Step 2: Implement** — `src/lib/prompt/classify.ts`

```ts
import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'

const CLASSIFIER_PROMPT = `You classify 3D-print requests as either:
- p = parametric/functional/geometric (cubes, brackets, vases, hooks, organizers, tools, anything that can be built from primitives + boolean operations)
- g = generative/figurative/organic (characters, masks, helmets, miniatures, sculptures, animals, anything requiring sculpted free-form surfaces)

Respond with exactly one character: p or g. No explanation.`

export async function classifyIntent(userMessage: string): Promise<'parametric' | 'generative'> {
  try {
    const { text } = await generateText({
      model: getClassifierModel(),
      system: CLASSIFIER_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 4,
    })
    const c = text.trim().toLowerCase().charAt(0)
    return c === 'g' ? 'generative' : 'parametric'
  } catch {
    return 'parametric' // safe fallback
  }
}
```

- [ ] **Step 3: Extend `src/lib/llm/model.ts`** to add `getClassifierModel`:

```ts
// Append to the existing file:
import { anthropic } from '@ai-sdk/anthropic'
import { gateway } from 'ai'

const CLASSIFIER_MODEL_ID = 'claude-haiku-4-5'

export function getClassifierModel(): LanguageModel {
  if (process.env.AI_GATEWAY_API_KEY) return gateway(`anthropic/${CLASSIFIER_MODEL_ID}`)
  if (process.env.ANTHROPIC_API_KEY) return anthropic(CLASSIFIER_MODEL_ID)
  throw new Error('No LLM credentials for classifier')
}
```

- [ ] **Step 4: Run, expect 3 passed**

```bash
pnpm test tests/unit/classifier.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt/classify.ts src/lib/llm/model.ts tests/unit/classifier.test.ts
git commit -m "feat(prompt): intent classifier (haiku, p/g)"
```

---

## Task 4: Refactor `/api/generate` to branch on strategy

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

---

## Task 5: Worker accepts STL input

**Files:** `src/lib/jscad/runner.ts`, `src/lib/jscad/worker-entry.ts`, `src/lib/jscad/worker-client.ts`, `tests/unit/stl-parser.test.ts`

The worker currently takes `{ code: string }` and produces positions + STL. For the generative path we already HAVE the STL — we just need positions for the viewer.

- [ ] **Step 1: Failing test** — `tests/unit/stl-parser.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseBinarySTL } from '@/lib/jscad/runner'

describe('parseBinarySTL', () => {
  it('extracts triangle positions from binary STL', () => {
    // Build a tiny binary STL with one triangle: (0,0,0)-(1,0,0)-(0,1,0)
    const buf = new ArrayBuffer(84 + 50)
    const dv = new DataView(buf)
    dv.setUint32(80, 1, true)
    const base = 84
    // normal (zeros are fine for this test)
    // vertices
    dv.setFloat32(base + 12, 0, true); dv.setFloat32(base + 16, 0, true); dv.setFloat32(base + 20, 0, true)
    dv.setFloat32(base + 24, 1, true); dv.setFloat32(base + 28, 0, true); dv.setFloat32(base + 32, 0, true)
    dv.setFloat32(base + 36, 0, true); dv.setFloat32(base + 40, 1, true); dv.setFloat32(base + 44, 0, true)
    const stl = new Uint8Array(buf)

    const positions = parseBinarySTL(stl)
    expect(positions.length).toBe(9)
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })
})
```

- [ ] **Step 2: Export `parseBinarySTL` from runner.ts**

Add to `src/lib/jscad/runner.ts`:

```ts
export function parseBinarySTL(stl: Uint8Array): Float32Array {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const triCount = dv.getUint32(80, true)
  const positions = new Float32Array(triCount * 9)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(base + 12 + v * 4, true)
    }
  }
  return positions
}
```

- [ ] **Step 3: Extend `JscadResult` shape** in `runner.ts`:

The existing type already has `positions + stl`. For STL input, we want a function that just returns positions. Add a separate helper but the existing `runJscad` signature stays the same.

- [ ] **Step 4: Update worker entry** — `src/lib/jscad/worker-entry.ts`:

```ts
import { runJscad, parseBinarySTL } from './runner'

type Input =
  | { type: 'jscad'; code: string }
  | { type: 'stl'; stl: Uint8Array }

self.onmessage = async (e: MessageEvent<Input>) => {
  const msg = e.data
  if (msg.type === 'jscad') {
    const result = await runJscad(msg.code)
    ;(self as unknown as Worker).postMessage(result)
    return
  }
  if (msg.type === 'stl') {
    try {
      const positions = parseBinarySTL(msg.stl)
      ;(self as unknown as Worker).postMessage({
        ok: true,
        positions,
        triangleCount: positions.length / 9,
        stl: msg.stl,
      })
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ ok: false, error: String(err) })
    }
  }
}
```

- [ ] **Step 5: Update worker-client.ts**

```ts
import type { JscadResult } from './runner'

type Input = { type: 'jscad'; code: string } | { type: 'stl'; stl: Uint8Array }

let worker: Worker | null = null
let pending: { resolve: (r: JscadResult) => void; reject: (e: unknown) => void } | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<JscadResult>) => {
    pending?.resolve(e.data)
    pending = null
  }
  worker.onerror = (e) => {
    pending?.reject(e)
    pending = null
    worker?.terminate()
    worker = null
  }
  return worker
}

export function runInWorker(input: Input): Promise<JscadResult> {
  if (pending) return Promise.reject(new Error('Another job is in flight'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    ensureWorker().postMessage(input)
  })
}
```

- [ ] **Step 6: Run + commit**

```bash
pnpm test tests/unit/stl-parser.test.ts
pnpm tsc --noEmit
git add src/lib/jscad/ tests/unit/stl-parser.test.ts
git commit -m "feat(worker): accept binary STL input + parseBinarySTL helper"
```

---

## Task 6: Client wiring — Chat + Workspace handle both paths

**Files:** `src/components/Chat.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Update Chat.tsx**

Rewrite `send()` and message types to handle JSON responses with both shapes:

```tsx
type Msg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
  meshBase64?: string
  meshUrl?: string
}

// Inside send(), replace the fetch + body parsing:
const res = await fetch('/api/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId, message: userText }),
})
if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
const body = (await res.json()) as
  | { strategy: 'parametric'; iteration_id: string; jscad_code: string }
  | { strategy: 'generative'; iteration_id: string; mesh_url: string | null; mesh_base64: string | null; meta: { task_id: string; took_ms: number } }

if (body.strategy === 'parametric') {
  setMessages((m) => [
    ...m,
    { role: 'assistant', text: body.jscad_code, iterationId: body.iteration_id, strategy: 'parametric' },
  ])
  onResult({ kind: 'parametric', iterationId: body.iteration_id, code: body.jscad_code })
} else {
  setMessages((m) => [
    ...m,
    {
      role: 'assistant',
      text: `Generated via Meshy in ${(body.meta.took_ms / 1000).toFixed(0)}s`,
      iterationId: body.iteration_id,
      strategy: 'generative',
      meshUrl: body.mesh_url ?? undefined,
      meshBase64: body.mesh_base64 ?? undefined,
    },
  ])
  onResult({
    kind: 'generative',
    iterationId: body.iteration_id,
    meshUrl: body.mesh_url ?? null,
    meshBase64: body.mesh_base64 ?? null,
  })
}
```

The `onIterationReady` callback prop is now `onResult` with a discriminated union — update the prop type accordingly. Add a tiny pill-style badge next to assistant messages showing `parametric` or `generative`:

```tsx
{m.role === 'assistant' && m.strategy && (
  <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-700 uppercase">
    {m.strategy === 'generative' ? 'meshy' : 'jscad'}
  </span>
)}
```

- [ ] **Step 2: Update ProjectWorkspace.tsx**

The workspace now receives either a `code` or a `meshUrl`/`meshBase64` from the chat. Update the state and the worker call:

```tsx
const onResult = async (r:
  | { kind: 'parametric'; iterationId: string; code: string }
  | { kind: 'generative'; iterationId: string; meshUrl: string | null; meshBase64: string | null }
) => {
  setIterationId(r.iterationId)
  setError(null)
  if (r.kind === 'parametric') {
    const result = await runInWorker({ type: 'jscad', code: r.code })
    if (result.ok) {
      setPositions(result.positions)
      setStl(result.stl)
    } else setError(result.error)
  } else {
    let stlBytes: Uint8Array
    if (r.meshUrl) {
      const res = await fetch(r.meshUrl)
      stlBytes = new Uint8Array(await res.arrayBuffer())
    } else if (r.meshBase64) {
      const binary = atob(r.meshBase64)
      stlBytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) stlBytes[i] = binary.charCodeAt(i)
    } else {
      setError('Generative result has no mesh URL or inline bytes')
      return
    }
    const result = await runInWorker({ type: 'stl', stl: stlBytes })
    if (result.ok) {
      setPositions(result.positions)
      setStl(stlBytes)
    } else setError(result.error)
  }
}
```

Initial history hydration: when an iteration has `strategy === 'generative'`, hydrate by fetching its `meshBlobUrl` and parsing the STL. For `'parametric'`, run the saved `jscadCode` through the worker as before.

- [ ] **Step 3: tsc clean**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(ui): dispatch worker on parametric vs generative result"
```

---

## Task 7: E2E test with mocked Meshy

**Files:** `tests/e2e/generative-flow.spec.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

// Minimal 1-triangle STL (684 = 84+50*12 won't help here; we want 1 triangle = 134 bytes)
function makeOneTriangleSTL(): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.writeUInt32LE(1, 80)
  // triangle (0,0,0) (1,0,0) (0,1,0)
  buf.writeFloatLE(1, 96)  // vertex 1.x at offset 84+12
  buf.writeFloatLE(1, 124) // vertex 2.y at offset 84+40
  return buf
}

test('generative request goes through Meshy mock and renders a canvas', async ({ page }) => {
  // Mock the API to return a generative response with inline base64 STL.
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000050',
        mesh_url: null,
        mesh_base64: makeOneTriangleSTL().toString('base64'),
        meta: { task_id: 'mock_task_1', took_ms: 12345 },
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')
  await page.fill('input[name="title"]', 'Generative E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'iron man helmet')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  // Expect the "meshy" badge in chat history
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/meshy/i, { timeout: 10_000 })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
})
```

- [ ] **Step 2: Run**

```bash
E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e tests/e2e/generative-flow.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/generative-flow.spec.ts
git commit -m "test(e2e): generative path renders via mocked Meshy response"
```

---

## Task 8: Manual smoke (human only)

- [ ] **Step 1: Ensure env is set**

`.env.local` has `MESHY_API_KEY="msy_..."`. Restart `pnpm dev` if it was running before the key was added.

- [ ] **Step 2: Run the same suite of prompts, plus figurative ones**

Visit the test-login URL, create projects, send:

| Prompt | Expected strategy |
|---|---|
| `um cubo de 40mm` | parametric (jscad) |
| `um porta-chaves de 80x40x5mm` | parametric |
| `um capacete do homem de ferro tamanho real` | generative (meshy) |
| `uma miniatura de cachorro labrador` | generative |
| `uma luminária hexagonal com 5 furos circulares` | parametric |

For each:
- Check the strategy badge in chat
- Confirm viewer renders something recognizable
- For generative requests, expect ~30-90s wait with spinner
- After approving, click **Slice for printing** — slicer should accept the Meshy mesh (it's valid binary STL)

If generative quality is poor (Meshy preview is faster but lower-quality), revisit Task 2 step 4 and switch `mode: 'preview'` → `mode: 'refine'` (5x slower, much better).

- [ ] **Step 3: `tn done` the task and let the user report findings**

---

## Phase 6 — Done criteria

- [ ] `MESHY_API_KEY` set in env validates; missing key gracefully falls back to parametric for generative requests instead of crashing.
- [ ] DB migration applied: iterations rows have `strategy` and `meshBlobUrl` columns.
- [ ] Classifier returns `'p'` or `'g'` for the 5 fixture prompts in the manual smoke.
- [ ] `/api/generate` returns `application/json` with `strategy` field for both paths.
- [ ] Web Worker accepts either `{ type: 'jscad', code }` or `{ type: 'stl', stl }` and produces a `positions: Float32Array` for the viewer.
- [ ] Chat history shows a `jscad` or `meshy` badge per assistant message.
- [ ] Sliced 3MFs from generative meshes download and open in Bambu Studio.

## What's next (Phase 7+)

- **Image-to-3D**: pass the project's reference image to Meshy's image-to-3d endpoint instead of (or alongside) text.
- **Streaming generative status**: WebSocket or SSE updates from the polling loop into the UI.
- **Refine mode toggle**: let the user pay more credits for higher quality on a per-iteration basis.
- **Multi-extruder** (Phase 2 from the original plan, still pending).

## Tracking

Tasks created by `/tn-from-plan` on 2026-05-16 14:19:01:
- TASK-030: Schema migration — strategy + mesh url
- TASK-031: Meshy.ai REST client
- TASK-032: Intent classifier
- TASK-033: Refactor `/api/generate` to branch on strategy
- TASK-034: Worker accepts STL input
- TASK-035: Client wiring — Chat + Workspace handle both paths
- TASK-036: E2E test with mocked Meshy
- TASK-037: Manual smoke (human only)
