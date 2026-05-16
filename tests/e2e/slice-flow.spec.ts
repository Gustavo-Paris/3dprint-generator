import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

const FIXTURE_CODE = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })
module.exports = { main }`

test('user generates a cube, slices it, sees stats and a download button', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'parametric',
        iteration_id: '00000000-0000-0000-0000-000000000099',
        jscad_code: FIXTURE_CODE,
      }),
    })
  })

  // Mock /api/slice — don't invoke the real slicer in CI/E2E
  await page.route('**/api/slice', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: null,
        inline_base64: Buffer.from('PKfake-3mf-bytes').toString('base64'),
        meta: { print_time_min: 42, filament_g: 7.3 },
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')
  await page.fill('input[name="title"]', 'Slice E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'a cube')
  await page.locator('[data-testid="chat-input"]').press('Enter')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })

  // Click slice
  await page.click('button:has-text("Slice for printing")')

  // Wait for stats panel
  await expect(page.locator('text=42 min')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('text=7.3 g')).toBeVisible()
  await expect(page.locator('button:has-text("Download .3mf")')).toBeVisible()
})
