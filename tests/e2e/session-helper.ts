import type { Page } from '@playwright/test'

export async function signInE2E(page: Page, email: string) {
  // Uses the dedicated E2E sign-in route (only active when E2E_ALLOW_TEST_LOGIN=1).
  // It inserts/reuses a DB user, creates a session token, and sets the bare
  // `authjs.session-token` cookie (non-secure, so it survives over plain http in
  // both `next dev` locally and `next start` in CI) via redirect, landing on /.
  // Auth.js reads that bare name over http even in a prod build, so no cookie
  // mirroring / reload is needed.
  const url = `/api/auth/test-login?email=${encodeURIComponent(email)}`
  await page.goto(url)
  await page.waitForURL(/\/$/)
}
