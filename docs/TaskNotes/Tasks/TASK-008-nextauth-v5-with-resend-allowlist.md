---
uid: task-008
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# NextAuth v5 with Resend + allowlist

**Files:** `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/sign-in/page.tsx`

- [ ] **Step 1: NextAuth config**

`src/auth.ts`:

```ts
import NextAuth from 'next-auth'
import Resend from 'next-auth/providers/resend'
import Credentials from 'next-auth/providers/credentials'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, accounts, sessions, verificationTokens } from '@/db/schema'
import { allowedEmails, env } from '@/env'

const isE2E = env.E2E_ALLOW_TEST_LOGIN === '1'

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  providers: [
    Resend({ apiKey: env.AUTH_RESEND_KEY, from: env.AUTH_EMAIL_FROM }),
    ...(isE2E
      ? [
          Credentials({
            id: 'e2e',
            credentials: { email: { label: 'Email', type: 'email' } },
            async authorize(credentials) {
              const email = String(credentials?.email ?? '').toLowerCase()
              if (!allowedEmails.has(email)) return null
              const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
              if (existing) return { id: existing.id, email }
              const [u] = await db.insert(users).values({ email }).returning()
              return { id: u.id, email }
            },
          }),
        ]
      : []),
  ],
  pages: { signIn: '/sign-in' },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      return allowedEmails.has(user.email.toLowerCase())
    },
  },
})
```

- [ ] **Step 2: Route handler**

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 3: Sign-in page**

`src/app/sign-in/page.tsx`:

```tsx
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
```

- [ ] **Step 4: Manual smoke**

`pnpm dev`, visit `/sign-in`, enter your allowlisted email, submit. Check Resend dashboard for the link. Click it; should land at `/`.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/app/api/auth/ src/app/sign-in/
git commit -m "feat(auth): NextAuth v5 magic link + allowlist + E2E credentials"
```
