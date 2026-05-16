---
uid: task-004
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

# Configure Playwright with a homepage smoke

**Files:** `playwright.config.ts`, `tests/e2e/homepage.spec.ts`

- [ ] **Step 1: Create config**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { E2E_ALLOW_TEST_LOGIN: '1' },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
```

- [ ] **Step 2: Write a homepage smoke test**

`tests/e2e/homepage.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('sign-in page renders for anonymous user', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.locator('h1')).toContainText('Sign in')
})
```

- [ ] **Step 3: Skip running until Task 9 wires sign-in**

Skip the run for this task; we'll run it after Task 9.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/homepage.spec.ts
git commit -m "test: configure Playwright with sign-in smoke"
```
