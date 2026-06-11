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
  // Required under `next start` (and Railway): NextAuth v5 otherwise throws
  // UntrustedHost on every auth() because it can't infer the deployment URL,
  // which silently blanks the whole app. AUTH_TRUST_HOST in the env is the belt.
  trustHost: true,
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
