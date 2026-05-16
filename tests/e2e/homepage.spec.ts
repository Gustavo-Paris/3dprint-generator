import { test, expect } from '@playwright/test'

test('sign-in page renders for anonymous user', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.locator('h1')).toContainText('Sign in')
})
