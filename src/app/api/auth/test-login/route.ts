import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, sessions } from '@/db/schema'
import { env, allowedEmails } from '@/env'

/**
 * E2E-only sign-in endpoint. Creates a DB session and sets the Auth.js session
 * cookie directly, bypassing the OAuth/email flow.
 *
 * Only available when E2E_ALLOW_TEST_LOGIN=1.
 */
export async function GET(req: NextRequest) {
  if (env.E2E_ALLOW_TEST_LOGIN !== '1') {
    return NextResponse.json({ error: 'Not available' }, { status: 403 })
  }

  const email = req.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'email param required' }, { status: 400 })
  }

  const normalised = email.toLowerCase().trim()
  if (!allowedEmails.has(normalised)) {
    return NextResponse.json({ error: 'Email not allowed' }, { status: 403 })
  }

  // Upsert user
  let user = await db.query.users.findFirst({ where: eq(users.email, normalised) })
  if (!user) {
    const [inserted] = await db.insert(users).values({ email: normalised }).returning()
    user = inserted
  }

  // Create session (30-day expiry)
  const sessionToken = randomUUID()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires })

  // This route is E2E-only (403 unless E2E_ALLOW_TEST_LOGIN=1) and is always
  // served over plain http — `next dev` locally and `next start` over http in
  // CI. Over http, Auth.js reads the BARE cookie name `authjs.session-token`
  // even in a production build (the `__Secure-` prefix is only used over https),
  // and browsers reject `__Secure-`/secure cookies over http. So always set the
  // bare, non-secure cookie here, regardless of NODE_ENV. Real production never
  // reaches this code (the route 403s), so app auth cookies are unaffected.
  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.set('authjs.session-token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    expires,
    path: '/',
  })

  return res
}
