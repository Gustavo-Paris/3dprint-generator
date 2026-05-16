---
uid: task-003
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

# Configure Vitest with a smoke test

**Files:** `vitest.config.ts`, `tests/unit/smoke.test.ts`, `package.json`

- [ ] **Step 1: Create vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

- [ ] **Step 2: Add scripts to package.json**

In `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test"
```

- [ ] **Step 3: Write a passing smoke test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Run it**

```bash
pnpm test
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/unit/smoke.test.ts package.json
git commit -m "test: configure Vitest with smoke test"
```
