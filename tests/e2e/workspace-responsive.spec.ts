import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

test('viewer slot stays within a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')

  // Create a project so we land on the workspace (CI-safe: no pre-existing data).
  await page.fill('input[name="title"]', 'Responsive E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  const viewer = page.getByTestId('viewer-slot')
  await expect(viewer).toBeVisible()
  const box = await viewer.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1) // within viewport, ~1px tolerance
  expect(box!.width).toBeGreaterThan(200) // not collapsed
})
