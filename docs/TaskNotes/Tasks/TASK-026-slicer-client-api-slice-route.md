---
uid: task-026
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:4
- slicer
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Slicer client + `/api/slice` route

**Files:** `src/lib/slicer/client.ts`, `src/app/api/slice/route.ts`, `src/env.ts` (extend)

- [ ] **Step 1: Add `SLICER_URL` to env**

In `src/env.ts`, add `SLICER_URL: z.string().url().default('http://localhost:8787')` to the schema. Also append to `.env.example`:

```
SLICER_URL="http://localhost:8787"
```

- [ ] **Step 2: Slicer client**

`src/lib/slicer/client.ts`:

```ts
import { env } from '@/env'

export type SliceResult = {
  bytes: Uint8Array
  meta: {
    print_time_min: number | null
    filament_g: number | null
  }
}

export async function sliceStl(stl: Uint8Array): Promise<SliceResult> {
  const stl_base64 = Buffer.from(stl).toString('base64')
  const res = await fetch(`${env.SLICER_URL}/slice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stl_base64 }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`Slicer ${res.status}: ${errorBody.slice(0, 1000)}`)
  }

  const json = (await res.json()) as { bytes_base64: string; meta: SliceResult['meta'] }
  return { bytes: Buffer.from(json.bytes_base64, 'base64'), meta: json.meta }
}
```

- [ ] **Step 3: `/api/slice` route**

`src/app/api/slice/route.ts`:

```ts
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { sliceStl } from '@/lib/slicer/client'
import { put } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 180

const Body = z.object({
  iterationId: z.string().uuid(),
  stlBase64: z.string().min(1),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { iterationId, stlBase64 } = parsed.data

  // Verify the iteration belongs to a project the user owns.
  const [row] = await db
    .select({ iteration: iterations, project: projects })
    .from(iterations)
    .innerJoin(projects, eq(iterations.projectId, projects.id))
    .where(and(eq(iterations.id, iterationId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!row) return new Response('Not found', { status: 404 })

  let result
  try {
    result = await sliceStl(Buffer.from(stlBase64, 'base64'))
  } catch (e) {
    return new Response(`Slicer error: ${(e as Error).message}`, { status: 502 })
  }

  // Upload 3MF to Blob. Skip if BLOB_READ_WRITE_TOKEN is missing in dev — fall back
  // to returning the base64 inline (the client knows how to download both).
  const filename = `${session.user.id}/${row.project.id}/${iterationId}.3mf`
  let slicedUrl: string | null = null
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(filename, result.bytes, { access: 'public', addRandomSuffix: false })
    slicedUrl = blob.url
  }

  await db
    .update(iterations)
    .set({
      slicedBlobUrl: slicedUrl,
      slicedMeta: result.meta,
      slicedAt: new Date(),
      status: 'sliced',
    })
    .where(eq(iterations.id, iterationId))

  return Response.json({
    url: slicedUrl,
    inline_base64: slicedUrl ? null : Buffer.from(result.bytes).toString('base64'),
    meta: result.meta,
  })
}
```

- [ ] **Step 4: tsc clean**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/lib/slicer/ src/app/api/slice/ .env.example
git commit -m "feat(api): /api/slice proxies STL → slicer → 3MF, persists meta"
```
