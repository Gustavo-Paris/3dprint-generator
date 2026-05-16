import type { Page } from '@playwright/test'

export async function signInE2E(page: Page, email: string) {
  // Uses the dedicated E2E sign-in route (only active when E2E_ALLOW_TEST_LOGIN=1).
  // It inserts/reuses a DB user, creates a session token, sets the Auth.js session
  // cookie via redirect, and lands on /.
  const url = `/api/auth/test-login?email=${encodeURIComponent(email)}`
  await page.goto(url)
  await page.waitForURL(/\/$/)
}
