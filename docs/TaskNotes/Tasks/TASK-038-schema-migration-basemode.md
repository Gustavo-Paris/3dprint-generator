---
uid: task-038
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-05-16
pomodoros: 0
contexts:
- phase:7
- image
- trophy
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Schema migration — baseMode

**Files:** `src/db/schema.ts`, generated migration

Add to `iterations`:

```ts
  baseMode: text('base_mode', { enum: ['mesh_only', 'with_base'] }),
```

Nullable (parametric iterations have null). Migration is additive.

```bash
pnpm db:generate
pnpm db:migrate
docker exec 3dgen-postgres psql -U app -d app -c "\d iterations" | grep base_mode
```

Commit: `feat(db): add base_mode to iterations`.
