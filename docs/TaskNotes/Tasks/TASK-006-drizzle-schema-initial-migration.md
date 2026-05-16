---
uid: task-006
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

# Drizzle schema + initial migration

**Files:** `drizzle.config.ts`, `src/db/schema.ts`, `src/db/index.ts`, generated migration in `drizzle/`, `package.json`

- [ ] **Step 1: Drizzle config**

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'
config({ path: '.env.local' })

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 2: Schema**

`src/db/schema.ts`:

```ts
import { pgTable, text, timestamp, uuid, jsonb, primaryKey, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerAccountId] }) }),
)

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
)

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  currentIterationId: uuid('current_iteration_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const iterations = pgTable('iterations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentIterationId: uuid('parent_iteration_id'),
  userMessage: text('user_message').notNull(),
  imageBlobUrl: text('image_blob_url'),
  jscadCode: text('jscad_code'),
  validationReport: jsonb('validation_report'),
  status: text('status', { enum: ['generating', 'ready', 'failed'] }).notNull(),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const projectsRelations = relations(projects, ({ many, one }) => ({
  iterations: many(iterations),
  user: one(users, { fields: [projects.userId], references: [users.id] }),
}))

export const iterationsRelations = relations(iterations, ({ one }) => ({
  project: one(projects, { fields: [iterations.projectId], references: [projects.id] }),
}))
```

Multi-extruder fields (`tmf_blob_url`, etc.) are deliberately deferred to Phase 2.

- [ ] **Step 3: DB client**

`src/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from './schema'

const client = postgres(env.DATABASE_URL, { max: 10 })
export const db = drizzle(client, { schema })
```

- [ ] **Step 4: db scripts**

In `package.json` `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 5: Generate + migrate**

```bash
pnpm db:generate
pnpm db:migrate
```

Verify:

```bash
docker exec -it 3dgen-postgres psql -U app -d app -c "\dt"
```

Should list `users`, `accounts`, `sessions`, `verificationToken`, `projects`, `iterations`.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts src/db/ drizzle/ package.json pnpm-lock.yaml
git commit -m "feat(db): initial schema and migration"
```
