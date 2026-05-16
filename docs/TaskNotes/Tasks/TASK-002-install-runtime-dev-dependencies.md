---
uid: task-002
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

# Install runtime + dev dependencies

**Files:** `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add \
  drizzle-orm postgres \
  next-auth@beta @auth/drizzle-adapter resend \
  ai \
  @jscad/modeling \
  three @react-three/fiber @react-three/drei \
  @vercel/blob \
  zod
```

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D \
  drizzle-kit dotenv \
  vitest @vitejs/plugin-react jsdom \
  @playwright/test \
  tsx \
  @types/three
```

- [ ] **Step 3: Install Playwright browsers**

```bash
pnpm exec playwright install chromium
```

Expected: chromium downloaded.

- [ ] **Step 4: Commit lockfile**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install runtime and dev dependencies"
```
