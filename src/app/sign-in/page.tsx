import { signIn } from '@/auth'

export default function SignIn() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        action={async (formData) => {
          'use server'
          await signIn('resend', formData)
        }}
        className="w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-gray-500">
          We&apos;ll email you a magic link. Only allowlisted addresses can sign in.
        </p>
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full border rounded px-3 py-2"
        />
        <button type="submit" className="w-full bg-black text-white rounded py-2">
          Send magic link
        </button>
      </form>
    </main>
  )
}
