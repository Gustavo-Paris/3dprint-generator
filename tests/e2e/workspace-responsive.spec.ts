import { test, expect } from '@playwright/test'

const TOKEN = process.env.PW_SESSION_TOKEN!

test('viewer slot stays within a 390px viewport', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // Inject the prod (secure) session cookie programmatically so the node-runtime
  // proxy resolves the DB session. Browsers won't store a Secure cookie set over
  // plain HTTP, so we add it directly to the context.
  await context.addCookies([
    {
      name: '__Secure-authjs.session-token',
      value: TOKEN,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible()
  // open the first project from the home list
  await page.locator('a[href^="/projects/"]').first().click()
  const viewer = page.getByTestId('viewer-slot')
  await expect(viewer).toBeVisible()
  const box = await viewer.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1) // within viewport, ~1px tolerance
  expect(box!.width).toBeGreaterThan(200) // not collapsed
})
