import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

/** Minimal 1-triangle binary STL so the viewer mounts from inline bytes (no fetch). */
function makeOneTriangleSTL(): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.writeUInt32LE(1, 80)
  buf.writeFloatLE(0, 96); buf.writeFloatLE(0, 100); buf.writeFloatLE(0, 104)
  buf.writeFloatLE(10, 108); buf.writeFloatLE(0, 112); buf.writeFloatLE(0, 116)
  buf.writeFloatLE(0, 120); buf.writeFloatLE(10, 124); buf.writeFloatLE(0, 128)
  return buf
}

test('user generates a disc, slices it, sees stats and a download button', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Real /api/generate contract. Inline mesh_base64 so the viewer mounts
      // (a 404 mesh_url would leave the Slice button unrendered).
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000099',
        mesh_url: null,
        mesh_base64: makeOneTriangleSTL().toString('base64'),
        design: { kind: 'disc', diameterMm: 40, thicknessMm: 3 },
        design_adjustments: [],
        warnings: [],
        meta: { kind: 'disc', bbox_mm: { x: 40, y: 40, z: 3 } },
      }),
    })
  })

  // The SliceButton probes /api/slicer-health on mount and disables itself when
  // the slicer is unreachable. CI has no slicer at SLICER_URL (defaults to
  // localhost:8787), so without this mock the button never enables and the slice
  // never produces stats. We mock the slicer via /api/slice below, so report it
  // healthy here too.
  await page.route('**/api/slicer-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
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

  await page.fill('[data-testid="chat-input"]', 'a 40mm disc')
  await page.locator('[data-testid="chat-input"]').press('Enter')
  // Gate on the chat label (the mock mesh_url 404s, so the canvas may not mount).
  await expect(page.locator('[data-testid="chat-history"]')).toContainText('Disco / medalha', { timeout: 10_000 })

  // Click slice
  await page.click('button:has-text("Fatiar para impressão")')

  // Wait for stats panel
  await expect(page.locator('text=42 min')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('text=7.3 g')).toBeVisible()
  await expect(page.locator('button:has-text("Baixar .3mf")')).toBeVisible()
})
