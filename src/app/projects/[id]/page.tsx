import { auth } from '@/auth'
import { db } from '@/db'
import { projects, iterations } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { isUuid } from '@/lib/validation/uuid'
import { historyColumns } from '@/db/history-columns'
import ProjectWorkspace from '@/components/ProjectWorkspace'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

  return <ProjectWorkspace project={project} initialHistory={history} />
}
