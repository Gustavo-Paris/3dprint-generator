---
uid: task-036
status: open
priority: normal
scheduled: 2026-05-16
pomodoros: 0
contexts:
- phase:6
- meshy
- hybrid
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# E2E test with mocked Meshy

**Files:** `tests/e2e/generative-flow.spec.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

// Minimal 1-triangle STL (684 = 84+50*12 won't help here; we want 1 triangle = 134 bytes)
function makeOneTriangleSTL(): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.writeUInt32LE(1, 80)
  // triangle (0,0,0) (1,0,0) (0,1,0)
  buf.writeFloatLE(1, 96)  // vertex 1.x at offset 84+12
  buf.writeFloatLE(1, 124) // vertex 2.y at offset 84+40
  return buf
}

test('generative request goes through Meshy mock and renders a canvas', async ({ page }) => {
  // Mock the API to return a generative response with inline base64 STL.
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000050',
        mesh_url: null,
        mesh_base64: makeOneTriangleSTL().toString('base64'),
        meta: { task_id: 'mock_task_1', took_ms: 12345 },
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')
  await page.fill('input[name="title"]', 'Generative E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'iron man helmet')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  // Expect the "meshy" badge in chat history
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/meshy/i, { timeout: 10_000 })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
})
```

- [ ] **Step 2: Run**

```bash
E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e tests/e2e/generative-flow.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/generative-flow.spec.ts
git commit -m "test(e2e): generative path renders via mocked Meshy response"
```
