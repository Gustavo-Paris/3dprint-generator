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

  // Upload 3MF to Blob if configured; otherwise return inline base64 so the
  // client can save it without external storage (handy for local dev).
  const filename = `${session.user.id}/${row.project.id}/${iterationId}.3mf`
  let slicedUrl: string | null = null
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(filename, Buffer.from(result.bytes), {
      access: 'public',
      addRandomSuffix: false,
    })
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
