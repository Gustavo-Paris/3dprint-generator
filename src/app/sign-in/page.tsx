import { signIn } from '@/auth'
import { AuthError } from 'next-auth'
import { redirect, unstable_rethrow } from 'next/navigation'
import { Brand } from '@/components/Brand'

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-50 to-transparent"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand markClassName="h-8 w-8" textClassName="text-lg text-slate-900" />
        </div>

        <form
          action={async (formData) => {
            'use server'
            try {
              // Pass ONLY the email — spreading the whole formData leaks
              // Next's internal $ACTION_* keys into signIn, which breaks the
              // email extraction in production builds (AccessDenied) while
              // working in dev. Bug found on the first prod deploy.
              await signIn('resend', {
                email: String(formData.get('email') ?? '').trim().toLowerCase(),
                redirectTo: '/sign-in?sent=1',
              })
            } catch (e) {
              // Re-throw Next's control-flow errors (redirect/notFound) so the
              // success redirect propagates; only a real AuthError is a send failure.
              unstable_rethrow(e)
              if (e instanceof AuthError) redirect('/sign-in?error=EnvioFalhou')
              throw e
            }
          }}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-7"
        >
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Entrar</h1>
            <p className="text-sm text-slate-500">
              Enviamos um link mágico por e-mail. Só endereços autorizados conseguem entrar.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            >
              Não foi possível enviar o link. Verifique o e-mail e tente novamente.
            </div>
          )}
          {sent && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Link enviado — confira sua caixa de entrada.
            </div>
          )}

          <input
            name="email"
            type="email"
            required
            placeholder="voce@exemplo.com"
            aria-label="E-mail"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40"
          />
          <button
            type="submit"
            className="min-h-11 w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white shadow-soft transition hover:bg-brand-700 active:bg-brand-800"
          >
            Enviar link mágico
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-400">
          Gere, visualize e fatie peças para impressão 3D.
        </p>
      </div>
    </main>
  )
}
