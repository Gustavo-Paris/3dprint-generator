import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

const FIXTURE_CODE = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })
module.exports = { main }`

test('user signs in, creates project, generates a cube, sees it in the viewer', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'parametric',
        iteration_id: '00000000-0000-0000-0000-000000000001',
        jscad_code: FIXTURE_CODE,
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')

  await page.fill('input[name="title"]', 'E2E project')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'a 40mm cube')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  await expect(page.locator('[data-testid="chat-history"]')).toContainText('cuboid', { timeout: 5_000 })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 })
})
