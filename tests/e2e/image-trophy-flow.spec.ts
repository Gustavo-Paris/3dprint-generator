import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

/** Minimal 1-triangle binary STL — base64 encoded for the API mock to return. */
function makeOneTriangleSTL(): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.writeUInt32LE(1, 80)
  // vertices: (0,0,0) (10,0,0) (0,10,0)
  buf.writeFloatLE(0, 96);   buf.writeFloatLE(0, 100); buf.writeFloatLE(0, 104)
  buf.writeFloatLE(10, 108); buf.writeFloatLE(0, 112); buf.writeFloatLE(0, 116)
  buf.writeFloatLE(0, 120);  buf.writeFloatLE(10, 124); buf.writeFloatLE(0, 128)
  return buf
}

test('user uploads image with trophy keyword → renders generated trophy with base', async ({ page }) => {
  // Mock /api/upload — return a fake URL for the uploaded file
  await page.route('**/api/upload', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: '/uploads/mock-logo.png',
        content_type: 'image/png',
        size: 1234,
      }),
    })
  })

  // Mock /api/generate — return a generative response with base_mode='with_base'
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Real /api/generate contract: meta = { kind?, bbox_mm? }. A Meshy/freeform
      // mesh has no parametric `kind`, so resultLabel(meta) renders "Generated".
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000077',
        mesh_url: null,
        mesh_base64: makeOneTriangleSTL().toString('base64'),
        design: { kind: 'freeform', prompt: 'troféu', sourceImageUrl: '/uploads/mock-logo.png' },
        design_adjustments: [],
        warnings: [],
        meta: {},
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')
  await page.fill('input[name="title"]', 'Trofeu E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  // Upload a 1x1 PNG via the hidden file input
  const tinyPng = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C636200000000050001A5F645400000000049454E44AE426082',
    'hex',
  )
  await page.locator('[data-testid="chat-file-input"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: tinyPng,
  })

  // Wait for upload to finish — paperclip should be enabled again (no spinner)
  // (the attached image thumbnail appears in the strip above the form)
  await expect(page.locator('img[alt="attached preview"]')).toBeVisible({ timeout: 5_000 })

  // Type a trophy prompt and submit
  await page.fill('[data-testid="chat-input"]', 'troféu da logo da empresa')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  // Generative result with no parametric kind → resultLabel(meta) renders "Generated".
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/generated/i, {
    timeout: 10_000,
  })
  // Strategy badge meshy should appear (Chat.tsx, strategy === 'generative').
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/meshy/i)
  // Canvas should render the inline mesh_base64 STL (no network fetch).
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
})
