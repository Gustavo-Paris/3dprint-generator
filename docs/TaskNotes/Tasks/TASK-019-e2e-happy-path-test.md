---
uid: task-019
status: done
priority: normal
scheduled: 2026-05-15
completed: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# E2E happy-path test

**Files:** `tests/e2e/session-helper.ts`, `tests/e2e/generate-flow.spec.ts`

- [ ] **Step 1: Session helper**

`tests/e2e/session-helper.ts`:

```ts
import type { Page } from '@playwright/test'

export async function signInE2E(page: Page, email: string) {
  await page.goto('/api/auth/signin/e2e')
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
}
```

- [ ] **Step 2: Happy-path test**

`tests/e2e/generate-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

const FIXTURE_CODE = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })
module.exports = { main }`

test('user signs in, creates project, generates a cube, sees it in the viewer', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'x-iteration-id': '00000000-0000-0000-0000-000000000001',
        'content-type': 'text/plain',
      },
      body: FIXTURE_CODE,
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
```

- [ ] **Step 3: Run**

```bash
E2E_ALLOW_TEST_LOGIN=1 E2E_TEST_EMAIL=gustavo.b.paris@gmail.com pnpm test:e2e
```

Expected: 2 passed (homepage smoke + this one).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/
git commit -m "test(e2e): happy-path login → generate → viewer renders"
```
