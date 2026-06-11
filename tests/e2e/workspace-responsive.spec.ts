import { test, expect } from '@playwright/test'

const TOKEN = process.env.PW_SESSION_TOKEN!

test('viewer slot stays within a 390px viewport', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // Inject the session cookie directly so the proxy/page auth() resolves the DB
  // session. `next start` over http://localhost (local smoke AND CI) uses the BARE
  // cookie name `authjs.session-token` — NextAuth only switches to the `__Secure-`
  // prefix when the resolved origin (AUTH_URL) is https. Use the bare name here.
  await context.addCookies([
    {
      name: 'authjs.session-token',
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
