---
uid: task-020
status: open
priority: normal
scheduled: 2026-05-15
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

# README + final pass

**Files:** `README.md`

- [ ] **Step 1: README**

```markdown
# 3D Print Generator

Chat → 3D model → printer-ready file. See `docs/superpowers/specs/2026-05-15-3dprint-generator-design.md`.

## Local dev

```
docker compose up -d postgres
cp .env.example .env.local   # fill in secrets
pnpm install
pnpm db:migrate
pnpm dev
```

## Tests

```
pnpm test                                # unit + integration
E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e     # Playwright
```
