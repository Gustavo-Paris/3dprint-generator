---
uid: task-022
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

# Schema migration for sliced output

**Files:** `src/db/schema.ts`, generated migration in `drizzle/`

- [ ] **Step 1: Extend the iterations table**

In `src/db/schema.ts`, add three nullable columns to the `iterations` table definition:

```ts
  // Existing iterations fields above ...
  slicedBlobUrl: text('sliced_blob_url'),
  slicedMeta: jsonb('sliced_meta'),          // { print_time_min: number, filament_g: number, layer_count: number }
  slicedAt: timestamp('sliced_at'),
```

Update the status enum to include `'sliced'`:

```ts
  status: text('status', { enum: ['generating', 'ready', 'failed', 'sliced'] }).notNull(),
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm db:generate
pnpm db:migrate
docker exec 3dgen-postgres psql -U app -d app -c "\d iterations"
```

Expect to see `sliced_blob_url`, `sliced_meta`, `sliced_at` columns and the new enum value.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add sliced output columns to iterations"
```
