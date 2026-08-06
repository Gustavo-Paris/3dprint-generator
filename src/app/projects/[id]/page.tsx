import type { Metadata } from 'next'
import { auth } from '@/auth'
import { db } from '@/db'
import { projects, iterations } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { isUuid } from '@/lib/validation/uuid'
import { historyColumns } from '@/db/history-columns'
import {
  resolveConfig,
  DEFAULT_FILAMENT_COLOR_BODY,
  DEFAULT_FILAMENT_COLOR_ACCENT,
} from '@/lib/settings/store'
import ProjectWorkspace from '@/components/ProjectWorkspace'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (!isUuid(id)) return { title: 'Projeto' }
  const session = await auth()
  if (!session?.user?.id) return { title: 'Projeto' }
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1)
  return { title: project?.title ?? 'Projeto' }
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ seed?: string }>
}) {
  const { id } = await params
  const { seed: seedParam } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  // `projects.id` is a uuid column — a non-uuid param makes Postgres throw
  // (500 + SQL leak). Treat malformed ids as not-found.
  if (!isUuid(id)) notFound()

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) notFound()

  const history = await db
    .select(historyColumns)
    .from(iterations)
    .where(eq(iterations.projectId, project.id))
    .orderBy(asc(iterations.createdAt))

  // Only non-secret print fields cross to the client — never keys/secrets.
  const cfg = await resolveConfig()
  const printConfig = {
    printerModel: cfg.printerModel,
    bodyHex: cfg.filamentColorBody ?? DEFAULT_FILAMENT_COLOR_BODY,
    accentHex: cfg.filamentColorAccent ?? DEFAULT_FILAMENT_COLOR_ACCENT,
  }

  // Home gallery preset seed (rm-013) — cap length; ignore garbage.
  const seedPrompt =
    typeof seedParam === 'string' && seedParam.length > 0 && seedParam.length <= 500
      ? seedParam
      : null

  return (
    <ProjectWorkspace
      project={project}
      initialHistory={history}
      printConfig={printConfig}
      seedPrompt={seedPrompt}
    />
  )
}
