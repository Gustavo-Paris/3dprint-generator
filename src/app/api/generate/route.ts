import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { buildMessages } from '@/lib/prompt/build'
import { classifyIntent } from '@/lib/prompt/classify'
import { getModel } from '@/lib/llm/model'
import { generateMesh } from '@/lib/meshy/client'
import { generateText } from 'ai'
import { put } from '@vercel/blob'
import { and, asc, eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

  // Classify intent first (cheap haiku call). Generative requires MESHY_API_KEY;
  // if missing, fall back to parametric — Claude makes its best attempt.
  let strategy: 'parametric' | 'generative' = await classifyIntent(message)
  if (strategy === 'generative' && !process.env.MESHY_API_KEY) strategy = 'parametric'

  const [iteration] = await db
    .insert(iterations)
    .values({ projectId, userMessage: message, status: 'generating', strategy })
    .returning()

  if (strategy === 'generative') {
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

    let meshUrl: string
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const filename = `${session.user.id}/${projectId}/${iteration.id}.stl`
      const blob = await put(filename, Buffer.from(result.stl), {
        access: 'public',
        addRandomSuffix: false,
      })
      meshUrl = blob.url
    } else {
      // Local fallback: write to public/meshes so Next.js serves it at /meshes/<id>.stl.
      // Survives reloads; in prod, switch to Vercel Blob by setting BLOB_READ_WRITE_TOKEN.
      const dir = join(process.cwd(), 'public', 'meshes')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${iteration.id}.stl`), Buffer.from(result.stl))
      meshUrl = `/meshes/${iteration.id}.stl`
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
      mesh_base64: null,
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
