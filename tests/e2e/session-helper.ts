import type { Page } from '@playwright/test'

export async function signInE2E(page: Page, email: string) {
  // Uses the dedicated E2E sign-in route (only active when E2E_ALLOW_TEST_LOGIN=1).
  // It inserts/reuses a DB user, creates a session token, sets the Auth.js session
  // cookie via redirect, and lands on /.
  const url = `/api/auth/test-login?email=${encodeURIComponent(email)}`
  await page.goto(url)
  await page.waitForURL(/\/$/)

  // test-login sets the cookie under the `__Secure-` prefix (it keys on
  // NODE_ENV=production). But a prod build (`next start`) served over plain
  // http://localhost — both local smoke AND CI — makes auth() read the BARE
  // name `authjs.session-token` (NextAuth only uses `__Secure-` over https).
  // Mirror the session value onto the bare cookie so auth() resolves over http.
  const cookies = await page.context().cookies()
  const session = cookies.find((c) => c.name.endsWith('authjs.session-token'))
  if (session && session.name !== 'authjs.session-token') {
    await page.context().addCookies([
      {
        name: 'authjs.session-token',
        value: session.value,
        domain: session.domain,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ])
    await page.reload()
  }
}
