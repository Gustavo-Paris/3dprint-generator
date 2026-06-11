import { signIn } from '@/auth'
import { AuthError } from 'next-auth'
import { redirect, unstable_rethrow } from 'next/navigation'

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        action={async (formData) => {
          'use server'
          try {
            await signIn('resend', {
              ...Object.fromEntries(formData),
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
        className="w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="text-sm text-gray-500">
          Enviamos um link mágico por e-mail. Só endereços autorizados conseguem entrar.
        </p>
        {error && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            Não foi possível enviar o link. Verifique o e-mail e tente novamente.
          </div>
        )}
        {sent && (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Link enviado — confira sua caixa de entrada.
          </div>
        )}
        <input
          name="email"
          type="email"
          required
          placeholder="voce@exemplo.com"
          aria-label="E-mail"
          className="w-full border rounded px-3 py-2"
        />
        <button type="submit" className="w-full bg-black text-white rounded py-2">
          Enviar link mágico
        </button>
      </form>
    </main>
  )
}
