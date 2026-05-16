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

  // Auth.js v5 database strategy uses the cookie name "authjs.session-token"
  const cookieName =
    process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token'

  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  })

  return res
}
