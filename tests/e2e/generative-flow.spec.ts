import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

// Minimal binary STL: 1 triangle. Layout: 80-byte header + 4-byte uint32 count + 50 bytes per triangle.
function makeOneTriangleSTL(): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.writeUInt32LE(1, 80)
  // normal stays zero; write the 3 vertices starting at offset 84+12
  // (0,0,0) (1,0,0) (0,1,0)
  buf.writeFloatLE(0, 96);  buf.writeFloatLE(0, 100); buf.writeFloatLE(0, 104)
  buf.writeFloatLE(1, 108); buf.writeFloatLE(0, 112); buf.writeFloatLE(0, 116)
  buf.writeFloatLE(0, 120); buf.writeFloatLE(1, 124); buf.writeFloatLE(0, 128)
  return buf
}

test('generative request goes through Meshy mock and renders the canvas', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000050',
        mesh_url: null,
        mesh_base64: makeOneTriangleSTL().toString('base64'),
        // A real Meshy/freeform response carries design.kind 'freeform' — the
        // badge derives from it (badgeFor), not the stored strategy.
        design: { kind: 'freeform', prompt: 'iron man helmet' },
        design_adjustments: [],
        warnings: [],
        meta: {},
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')

  await page.fill('input[name="title"]', 'Generative E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'iron man helmet')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  // The strategy badge for a freeform design renders as "imagem" (badgeFor → PT-BR)
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/imagem/i, { timeout: 10_000 })

  // And the viewer canvas should render
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
})
