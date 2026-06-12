import Link from 'next/link'
import { BrandMark } from '@/components/Brand'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-soft">
        <BrandMark className="h-8 w-8" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Página não encontrada
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          O projeto ou a página que você procura não existe (ou não é sua).
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 active:bg-brand-800"
      >
        ← Voltar para meus projetos
      </Link>
    </main>
  )
}
