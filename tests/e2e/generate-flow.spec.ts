import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

test('user signs in, creates project, generates a parametric disc, sees it in the viewer', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Real /api/generate contract (src/app/api/generate/route.ts).
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000001',
        mesh_url: '/meshes/00000000-0000-0000-0000-000000000001.stl',
        mesh_base64: null,
        design: { kind: 'disc', diameterMm: 40, thicknessMm: 3 },
        design_adjustments: [],
        warnings: [],
        meta: { kind: 'disc', bbox_mm: { x: 40, y: 40, z: 3 } },
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')

  await page.fill('input[name="title"]', 'E2E project')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'a 40mm disc')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  // Chat renders resultLabel(meta) → "Disco / medalha (40×40×3 mm)".
  await expect(page.locator('[data-testid="chat-history"]')).toContainText('Disco / medalha', { timeout: 10_000 })
})
