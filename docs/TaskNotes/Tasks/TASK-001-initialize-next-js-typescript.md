---
uid: task-001
status: in-progress
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

# Initialize Next.js + TypeScript

**Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`, `.gitignore`

- [ ] **Step 1: Scaffold the app non-interactively**

Run from `/Users/gustavoparis/www/3dprint-generator`:

```bash
pnpm dlx create-next-app@latest . \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm --turbopack --no-git --yes
```

The dir has existing files (`.claude/`, `docs/`, `.gitignore`); accept the overwrite prompt. **Re-merge our `.gitignore` (keep `.superpowers/`)** in Step 3.

- [ ] **Step 2: Verify dev server boots**

```bash
pnpm dev
```

Expected: `Local: http://localhost:3000`. Open it — Next.js welcome page. Stop with Ctrl+C.

- [ ] **Step 3: Re-add ignores**

Append to `.gitignore`:

```
.superpowers/
.env.local
.env
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with TS + Tailwind"
```
