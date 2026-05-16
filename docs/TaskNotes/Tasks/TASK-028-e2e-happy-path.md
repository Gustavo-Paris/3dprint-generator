---
uid: task-028
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:4
- slicer
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# E2E happy path

**Files:** `tests/e2e/slice-flow.spec.ts`

- [ ] **Step 1: Mocked slice E2E test**

`tests/e2e/slice-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

const FIXTURE_CODE = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })
module.exports = { main }`

test('user generates a cube, slices it, downloads 3MF', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'x-iteration-id': '00000000-0000-0000-0000-000000000099',
        'content-type': 'text/plain',
      },
      body: FIXTURE_CODE,
    })
  })

  // Mock /api/slice — we don't want to invoke the real slicer in CI
  await page.route('**/api/slice', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: null,
        inline_base64: Buffer.from('PKfake-3mf-bytes').toString('base64'),
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
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 })

  // Slice
  await page.click('button:has-text("Slice for printing")')
  await expect(page.locator('text=42 min')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('text=7.3 g')).toBeVisible()
  // The download button is now present
  await expect(page.locator('button:has-text("Download .3mf")')).toBeVisible()
})
```

- [ ] **Step 2: Run**

```bash
E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e tests/e2e/slice-flow.spec.ts
```

Expect: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/slice-flow.spec.ts
git commit -m "test(e2e): slice flow happy path with mocked slicer"
```
