'use client'
/**
 * Home project card with a ⋯ menu (rename inline + two-step delete inline).
 * Native dialogs (window.prompt/confirm) are forbidden — both flows render
 * inside the card. Data props are computed server-side on the home page so
 * this component stays purely presentational + action-calling.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { renameProject, deleteProject } from '@/actions/projects'
import { BrandMark } from '@/components/Brand'

export type IterationStatus = 'generating' | 'ready' | 'failed' | 'sliced'

const STATUS_BADGE: Record<IterationStatus, { label: string; cls: string }> = {
  generating: { label: 'Gerando', cls: 'bg-amber-100 text-amber-700' },
  ready: { label: 'Pronto', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Falhou', cls: 'bg-red-100 text-red-700' },
  sliced: { label: 'Fatiado', cls: 'bg-sky-100 text-sky-700' },
}

export default function ProjectCard({
  id,
  title,
  relTime,
  iterCount,
  lastStatus,
  gradient,
}: {
  id: string
  title: string
  relTime: string
  iterCount: number
  lastStatus: IterationStatus | null
  gradient: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm-delete'>('view')
  const [draft, setDraft] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close menu / cancel confirm on outside click.
  useEffect(() => {
    if (!menuOpen && mode !== 'confirm-delete') return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        if (mode === 'confirm-delete') setMode('view')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen, mode])

  useEffect(() => {
    if (mode === 'rename') inputRef.current?.select()
  }, [mode])

  const submitRename = () => {
    const t = draft.trim()
    if (!t || t === title) {
      setMode('view')
      setDraft(title)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await renameProject(id, t)
        setMode('view')
        router.refresh()
      } catch {
        setError('Não foi possível renomear.')
      }
    })
  }

  const submitDelete = () => {
    setError(null)
    startTransition(async () => {
      try {
        await deleteProject(id)
        router.refresh()
      } catch {
        setError('Não foi possível excluir.')
        setMode('view')
      }
    })
  }

  return (
    <div
      ref={rootRef}
      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card"
    >
      <Link
        href={`/projects/${id}`}
        aria-label={`Abrir projeto ${title}`}
        className="block"
        tabIndex={mode === 'rename' ? -1 : undefined}
      >
        <div
          className="relative flex h-28 items-center justify-center overflow-hidden"
          style={{ backgroundImage: gradient }}
        >
          <BrandMark className="h-9 w-9 opacity-95 drop-shadow-sm transition-transform duration-200 group-hover:scale-110" />
        </div>
      </Link>

      <div className="p-4">
        {mode === 'rename' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitRename()
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor={`rename-${id}`} className="sr-only">
              Novo título do projeto
            </label>
            <input
              id={`rename-${id}`}
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setMode('view')
                  setDraft(title)
                }
              }}
              maxLength={200}
              disabled={isPending}
              className="min-h-9 w-full min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40"
            />
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {isPending ? '…' : 'Salvar'}
            </button>
          </form>
        ) : (
          <Link href={`/projects/${id}`} className="block">
            <div className="truncate font-medium text-slate-900 transition-colors group-hover:text-brand-700">
              {title}
            </div>
          </Link>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>Atualizado {relTime}</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span>
            {iterCount} {iterCount === 1 ? 'iteração' : 'iterações'}
          </span>
          {lastStatus && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[lastStatus].cls}`}
            >
              {STATUS_BADGE[lastStatus].label}
            </span>
          )}
        </div>

        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>

      <button
        type="button"
        aria-label={`Opções do projeto ${title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((v) => !v)
          setMode('view')
        }}
        className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/85 text-lg leading-none text-slate-700 shadow-soft backdrop-blur-sm transition hover:bg-white"
      >
        ⋯
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label={`Ações do projeto ${title}`}
          className="absolute right-2 top-11 z-20 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setDraft(title)
              setMode('rename')
            }}
            className="block w-full px-3 py-2 text-left text-slate-700 transition hover:bg-slate-50"
          >
            Renomear
          </button>
          {mode !== 'confirm-delete' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setMode('confirm-delete')}
              className="block w-full px-3 py-2 text-left text-red-600 transition hover:bg-red-50"
            >
              Excluir?
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={submitDelete}
              className="block w-full bg-red-600 px-3 py-2 text-left font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {isPending ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
