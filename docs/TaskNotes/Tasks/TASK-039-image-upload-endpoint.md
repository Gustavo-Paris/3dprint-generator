---
uid: task-039
status: open
priority: normal
scheduled: 2026-05-16
pomodoros: 0
contexts:
- phase:7
- image
- trophy
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Image upload endpoint

**Files:** `src/app/api/upload/route.ts`, `.gitignore`

```ts
// src/app/api/upload/route.ts
import { auth } from '@/auth'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return new Response('No file', { status: 400 })
  if (file.size > MAX_BYTES) return new Response('File too large (>5MB)', { status: 413 })
  if (!ACCEPTED.includes(file.type)) return new Response(`Unsupported type ${file.type}`, { status: 415 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const id = randomUUID()
  const bytes = Buffer.from(await file.arrayBuffer())

  let url: string
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${session.user.id}/uploads/${id}.${ext}`, bytes, {
      access: 'public',
      addRandomSuffix: false,
    })
    url = blob.url
  } else {
    const dir = join(process.cwd(), 'public', 'uploads')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${id}.${ext}`), bytes)
    url = `/uploads/${id}.${ext}`
  }

  return Response.json({ url, content_type: file.type, size: bytes.length })
}
```

Append `public/uploads/` to `.gitignore`.

Commit: `feat(upload): /api/upload accepts multipart image (5MB max, png/jpg/webp)`.
