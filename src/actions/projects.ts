'use server'
import { auth } from '@/auth'
import { db } from '@/db'
import { projects, iterations } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isUuid } from '@/lib/validation/uuid'
import { delMesh } from '@/lib/storage/persist'

const titleSchema = z.string().trim().min(1, 'Título vazio').max(200, 'Título longo demais')

export async function createProject(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  const title = String(formData.get('title') ?? '').trim() || 'Projeto sem título'
  const [p] = await db
    .insert(projects)
    .values({ userId: session.user.id, title })
    .returning()
  revalidatePath('/')
  redirect(`/projects/${p.id}`)
}

export async function renameProject(projectId: string, title: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  // Non-uuid ids make Postgres throw (500 + SQL leak) — reject before querying.
  if (!isUuid(projectId)) throw new Error('Not found')
  const clean = titleSchema.parse(title)

  // Ownership enforced by the WHERE — a non-owner update matches zero rows.
  const [updated] = await db
    .update(projects)
    .set({ title: clean, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .returning({ id: projects.id })
  if (!updated) throw new Error('Not found')

  revalidatePath('/')
  revalidatePath(`/projects/${projectId}`)
}

export async function deleteProject(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  if (!isUuid(projectId)) throw new Error('Not found')

  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!owned) throw new Error('Not found')

  // Best-effort asset cleanup BEFORE the row delete — the iterations rows vanish
  // via FK cascade (iterations.project_id ON DELETE CASCADE, schema.ts), and with
  // them the only reference to these URLs. We collect EVERY stored asset per
  // iteration (mesh, sliced 3MF, uploaded image, and the imported base mesh held
  // only in validationReport.baseMeshUrl) and dedupe — the imported base is
  // shared across an import's iterations, so it must be deleted exactly once.
  // NOTE: a failed delMesh is swallowed so it can't block the delete; on Vercel
  // Blob those bytes become unrecoverable orphans (the local orphan sweep only
  // scans public/meshes/) — acceptable vs. leaving the project undeletable.
  const iters = await db
    .select({
      meshBlobUrl: iterations.meshBlobUrl,
      slicedBlobUrl: iterations.slicedBlobUrl,
      imageBlobUrl: iterations.imageBlobUrl,
      validationReport: iterations.validationReport,
    })
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
  const assetUrls = new Set<string>()
  for (const it of iters) {
    const baseMeshUrl = (it.validationReport as { baseMeshUrl?: string } | null)?.baseMeshUrl
    for (const url of [it.meshBlobUrl, it.slicedBlobUrl, it.imageBlobUrl, baseMeshUrl]) {
      if (url) assetUrls.add(url)
    }
  }
  for (const url of assetUrls) {
    await delMesh(url).catch(() => {})
  }

  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))

  revalidatePath('/')
}
