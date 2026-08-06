import { auth, signOut } from '@/auth'
import { isAdminEmail } from '@/env'
import { db } from '@/db'
import { projects, iterations } from '@/db/schema'
import { count, desc, eq, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createProject } from '@/actions/projects'
import { paginate } from '@/lib/projects/paginate'
import { Brand, BrandMark } from '@/components/Brand'
import ProjectCard, { type IterationStatus } from '@/components/ProjectCard'
import { STARTER_PRESETS, kindLabelForStrategy } from '@/lib/projects/presets'

/** Human, short PT-BR relative time. Server-rendered once, so no hydration drift. */
function relativeTimePt(date: Date): string {
  const min = Math.round((Date.now() - date.getTime()) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** A stable, on-brand cool gradient per project so cards are scannable/distinct
 *  (critique P1-2: cards were all identical) without faking a real thumbnail. */
function thumbGradient(id: string): string {
  let acc = 0
  for (let i = 0; i < id.length; i++) acc = (acc * 31 + id.charCodeAt(i)) >>> 0
  const hue = 205 + (acc % 28) // 205–232: stay in the blue band, no violet drift
  return `linear-gradient(135deg, hsl(${hue} 84% 58%), hsl(${hue + 18} 72% 40%))`
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const { page: pageParam } = await searchParams
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
  const pg = paginate(pageParam, total)

  const myProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))
    .limit(pg.limit)
    .offset(pg.offset)

  // Card enrichment for the current page only: iteration count + last-iteration
  // status per project. Two cheap grouped queries over ≤ pg.limit projects.
  const pageIds = myProjects.map((p) => p.id)
  const [iterCounts, lastIters] =
    pageIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ projectId: iterations.projectId, n: count() })
            .from(iterations)
            .where(inArray(iterations.projectId, pageIds))
            .groupBy(iterations.projectId),
          // DISTINCT ON keeps only the newest iteration row per project.
          db
            .selectDistinctOn([iterations.projectId], {
              projectId: iterations.projectId,
              status: iterations.status,
              strategy: iterations.strategy,
            })
            .from(iterations)
            .where(inArray(iterations.projectId, pageIds))
            .orderBy(iterations.projectId, desc(iterations.createdAt)),
        ])
  const countByProject = new Map(iterCounts.map((r) => [r.projectId, r.n]))
  const statusByProject = new Map(lastIters.map((r) => [r.projectId, r.status]))
  const kindByProject = new Map(
    lastIters.map((r) => [r.projectId, kindLabelForStrategy(r.strategy)]),
  )

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="Gerador 3D — início">
            <Brand />
          </Link>
          <div className="flex items-center gap-1">
            {isAdminEmail(session.user.email) && (
              <Link
                href="/settings"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <span aria-hidden="true">⚙</span>
                <span className="hidden sm:inline">Configurações</span>
              </Link>
            )}
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/sign-in' })
              }}
            >
              <button className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                <span className="hidden max-w-[160px] truncate text-slate-400 sm:inline">
                  {session.user.email}
                </span>
                <span className="font-medium">Sair</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Seus projetos</h1>
          <p className="text-sm text-slate-500">
            Descreva uma peça ou suba uma imagem — geramos, visualizamos e fatiamos para impressão 3D.
          </p>
        </div>

        <form
          action={createProject}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="new-project-title" className="sr-only">
              Título do novo projeto
            </label>
            <input
              id="new-project-title"
              name="title"
              placeholder="Título do novo projeto"
              className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40"
            />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 active:bg-brand-800"
            >
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Criar projeto
            </button>
          </div>
        </form>

        <section aria-labelledby="presets-heading" data-testid="starter-presets">
          <h2 id="presets-heading" className="text-sm font-semibold text-slate-800">
            Comece por um modelo
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Cria o projeto e já deixa o pedido no chat — você só confirma ou ajusta.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {STARTER_PRESETS.map((preset) => (
              <li key={preset.id}>
                <form action={createProject}>
                  <input type="hidden" name="title" value={preset.title} />
                  <input type="hidden" name="seedPrompt" value={preset.prompt} />
                  <button
                    type="submit"
                    className="flex w-full flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card min-h-11"
                    data-testid={`preset-${preset.id}`}
                  >
                    <span className="text-xl" aria-hidden>
                      {preset.emoji}
                    </span>
                    <span className="text-xs font-semibold text-slate-900 leading-snug">
                      {preset.title}
                    </span>
                    <span className="text-[11px] text-slate-500">{preset.blurb}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        {myProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
            <BrandMark className="mx-auto h-10 w-10 opacity-60" />
            <p className="mt-3 font-medium text-slate-700">Nenhum projeto ainda</p>
            <p className="mt-1 text-sm text-slate-500">
              Crie seu primeiro projeto acima para começar.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myProjects.map((p) => (
              <li key={p.id}>
                <ProjectCard
                  id={p.id}
                  title={p.title}
                  relTime={relativeTimePt(p.updatedAt)}
                  iterCount={countByProject.get(p.id) ?? 0}
                  lastStatus={(statusByProject.get(p.id) ?? null) as IterationStatus | null}
                  gradient={thumbGradient(p.id)}
                  kindLabel={kindByProject.get(p.id) ?? null}
                />
              </li>
            ))}
          </ul>
        )}

        {(pg.hasPrev || pg.hasNext) && (
          <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
            {pg.hasPrev ? (
              <Link
                href={`/?page=${pg.page - 1}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-slate-600 transition hover:bg-white hover:text-brand-700 hover:shadow-soft"
              >
                ← Anteriores
              </Link>
            ) : (
              <span />
            )}
            <span className="text-slate-400">Página {pg.page}</span>
            {pg.hasNext ? (
              <Link
                href={`/?page=${pg.page + 1}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-slate-600 transition hover:bg-white hover:text-brand-700 hover:shadow-soft"
              >
                Próximos →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </main>
    </div>
  )
}
