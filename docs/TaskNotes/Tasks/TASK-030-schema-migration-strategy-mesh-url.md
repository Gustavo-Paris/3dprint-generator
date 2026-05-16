---
uid: task-030
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-05-16
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

# Schema migration — strategy + mesh url

**Files:** `src/db/schema.ts`, generated migration

- [ ] **Step 1: Extend iterations**

In `src/db/schema.ts`, add two columns to `iterations`:

```ts
  strategy: text('strategy', { enum: ['parametric', 'generative'] })
    .notNull()
    .default('parametric'),
  meshBlobUrl: text('mesh_blob_url'),
```

`jscadCode` stays nullable (already is). For generative iterations it'll be null, for parametric it's the code.

- [ ] **Step 2: Generate + migrate**

```bash
pnpm db:generate
pnpm db:migrate
docker exec 3dgen-postgres psql -U app -d app -c "\d iterations" | grep -E "strategy|mesh_blob"
```

Expect both new columns to appear.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add strategy + mesh_blob_url to iterations"
```
