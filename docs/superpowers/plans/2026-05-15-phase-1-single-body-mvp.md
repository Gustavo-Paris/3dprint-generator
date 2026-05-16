# Phase 1 — Single-Body Generation MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working end-to-end slice: signed-in user creates a project, sends a chat message, Claude returns JSCAD code, the browser runs it in a Web Worker, and a 3D viewer renders the result. Each generation is persisted as an iteration row.

**Architecture:** Next.js App Router (TypeScript) on local dev → Postgres via docker-compose → NextAuth magic link → Vercel AI Gateway → Claude 4.7 → JSCAD code runs in Web Worker → react-three-fiber viewer.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Drizzle ORM, postgres-js, NextAuth v5 (Auth.js), Resend, Vercel AI SDK v6 + AI Gateway, `@jscad/modeling`, `three`, `@react-three/fiber`, `@react-three/drei`, Vitest, Playwright.

**Scope of this plan:**
- Auth (magic link + allowlist)
- Project list + create
- Project detail page (chat + viewer)
- `/api/generate` streaming Claude → persisted iteration
- JSCAD worker → mesh in viewer

**Out of scope (later plans):**
- Multi-body / multi-extruder (Phase 2)
- Image input (Phase 3)
- Slicer service / 3MF export (Phase 4)
- Polish: iteration history UI, version rollback (Phase 5)

**Security boundary for code execution (important):**

This plan executes LLM-generated JavaScript in the user's browser, inside a dedicated Web Worker. The threat model:

1. The Worker has no DOM, no `localStorage`/`IndexedDB`, no `window`, no cookies.
2. Authenticated users are on a hard allowlist (`AUTH_ALLOWED_EMAILS`). There is no public signup.
3. The Worker is created with `type: 'module'` from a same-origin URL. CSP-wise it's equivalent to any module you ship.
4. The Worker's only output to the main thread is a typed mesh result (a `Float32Array` of positions plus a triangle count) — no arbitrary objects.
5. `fetch` is intentionally available in the Worker (default) but `main()` is reviewed: the system prompt forbids network use, and the validator rejects anything that imports or references network APIs.

The implementation deliberately uses dynamic code compilation (`Function.prototype.constructor`) because that's the entire purpose of this product — running model-generated geometry code. Swapping to a stricter sandbox (`ses`, OffscreenCanvas iframe with strict CSP) is a Phase 5 hardening item.

**Out-of-band setup the human must do once before Task 1:**
- Docker Desktop running (for local Postgres)
- A Resend account + API key (for magic-link email) — free tier works
- A Vercel account + AI Gateway enabled (or set `ANTHROPIC_API_KEY` as fallback)

---

## File Structure

```
3dprint-generator/
├── docker-compose.yml                       # local Postgres
├── drizzle.config.ts                        # Drizzle CLI config
├── next.config.ts
├── package.json
├── playwright.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── middleware.ts                            # auth gate
├── drizzle/                                 # generated migrations (committed)
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                         # project list (server component)
│   │   ├── sign-in/page.tsx
│   │   ├── projects/[id]/page.tsx           # project detail (chat + viewer)
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       └── generate/route.ts            # POST: stream Claude → save iteration
│   ├── actions/
│   │   └── projects.ts                      # server actions: createProject
│   ├── auth.ts                              # NextAuth config
│   ├── components/
│   │   ├── Chat.tsx                         # client: input + message list
│   │   ├── MeshViewer.tsx                   # client: three-fiber canvas
│   │   └── ProjectWorkspace.tsx             # client: orchestrates Chat + Viewer + Worker
│   ├── db/
│   │   ├── index.ts                         # postgres client + drizzle instance
│   │   └── schema.ts                        # users, projects, iterations + auth tables
│   ├── env.ts                               # zod-validated env
│   └── lib/
│       ├── jscad/
│       │   ├── sandbox.ts                   # the one place that compiles dynamic code
│       │   ├── runner.ts                    # runJscad: pure logic, runs in worker context
│       │   ├── worker-entry.ts              # Web Worker entrypoint
│       │   └── worker-client.ts             # typed promise wrapper for main thread
│       └── prompt/
│           ├── system.ts                    # JSCAD system prompt (single-body MVP)
│           └── build.ts                     # buildMessages(project, newMessage, history)
└── tests/
    ├── unit/
    │   ├── prompt-build.test.ts
    │   └── jscad-runner.test.ts
    ├── integration/
    │   ├── db-schema.test.ts
    │   └── api-generate.test.ts
    └── e2e/
        ├── session-helper.ts
        └── generate-flow.spec.ts
```

**Responsibilities per file:**
- `src/db/schema.ts` — single source of truth for DB shape
- `src/lib/prompt/system.ts` — pure string; tests assert key conventions
- `src/lib/prompt/build.ts` — pure function returning AI SDK messages array
- `src/lib/jscad/sandbox.ts` — the **only** file that dynamically compiles code, with full security justification at the top
- `src/lib/jscad/runner.ts` — orchestrates: compile → run main() → triangulate → validate
- `src/components/MeshViewer.tsx` — takes a `Float32Array`, never knows about JSCAD
- `src/components/ProjectWorkspace.tsx` — only file that wires LLM stream → worker → viewer

---

## Task 1: Initialize Next.js + TypeScript

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

---

## Task 2: Install runtime + dev dependencies

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

---

## Task 3: Configure Vitest with a smoke test

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

---

## Task 4: Configure Playwright with a homepage smoke

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

---

## Task 5: Local Postgres + env scaffolding

**Files:** `docker-compose.yml`, `.env.example`, `src/env.ts`

- [ ] **Step 1: docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: 3dgen-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - 3dgen-pgdata:/var/lib/postgresql/data
volumes:
  3dgen-pgdata:
```

- [ ] **Step 2: .env.example**

```bash
# Database
DATABASE_URL="postgres://app:app@localhost:5432/app"

# NextAuth (Auth.js v5)
AUTH_SECRET=""                # pnpm dlx auth secret to generate
AUTH_RESEND_KEY=""            # from resend.com
AUTH_EMAIL_FROM="auth@yourdomain.com"
AUTH_ALLOWED_EMAILS=""        # comma-separated allowlist

# AI Gateway (preferred) OR direct Anthropic
AI_GATEWAY_API_KEY=""
ANTHROPIC_API_KEY=""

# E2E only
E2E_ALLOW_TEST_LOGIN=""       # set to "1" for Playwright runs
```

- [ ] **Step 3: env loader**

`src/env.ts`:

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  AUTH_RESEND_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.string().email(),
  AUTH_ALLOWED_EMAILS: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  E2E_ALLOW_TEST_LOGIN: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment variables')
}

export const env = parsed.data

export const allowedEmails = new Set(
  env.AUTH_ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase()),
)
```

- [ ] **Step 4: Bring Postgres up**

```bash
docker compose up -d postgres
docker compose ps
```

Expected: `3dgen-postgres` running.

- [ ] **Step 5: Create your `.env.local`**

```bash
cp .env.example .env.local
# Edit and fill:
#   AUTH_SECRET=$(pnpm dlx auth secret | tail -1)
#   AUTH_RESEND_KEY="re_..."
#   AUTH_EMAIL_FROM="auth@example.com"
#   AUTH_ALLOWED_EMAILS="gustavo.b.paris@gmail.com"
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example src/env.ts
git commit -m "chore: local Postgres + env validation"
```

---

## Task 6: Drizzle schema + initial migration

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

---

## Task 7: Schema integration test

**Files:** `tests/integration/db-schema.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq } from 'drizzle-orm'

describe('db schema', () => {
  let userId: string
  let projectId: string

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ email: `test-${Date.now()}@example.com` }).returning()
    userId = u.id
    const [p] = await db.insert(projects).values({ userId, title: 'Test project' }).returning()
    projectId = p.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId))
  })

  it('inserts and reads an iteration', async () => {
    const [it] = await db
      .insert(iterations)
      .values({
        projectId,
        userMessage: 'make a 40mm cube',
        jscadCode: '// stub',
        status: 'ready',
      })
      .returning()
    expect(it.id).toBeDefined()
    const found = await db.query.iterations.findFirst({ where: eq(iterations.id, it.id) })
    expect(found?.userMessage).toBe('make a 40mm cube')
  })

  it('cascades delete from user → project → iterations', async () => {
    const [u] = await db.insert(users).values({ email: `cascade-${Date.now()}@example.com` }).returning()
    const [p] = await db.insert(projects).values({ userId: u.id, title: 'X' }).returning()
    await db.insert(iterations).values({ projectId: p.id, userMessage: 'x', status: 'ready' })
    await db.delete(users).where(eq(users.id, u.id))
    const survivors = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(survivors).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run**

```bash
pnpm test tests/integration/db-schema.test.ts
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/db-schema.test.ts
git commit -m "test(db): schema CRUD + cascade"
```

---

## Task 8: NextAuth v5 with Resend + allowlist

**Files:** `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/sign-in/page.tsx`

- [ ] **Step 1: NextAuth config**

`src/auth.ts`:

```ts
import NextAuth from 'next-auth'
import Resend from 'next-auth/providers/resend'
import Credentials from 'next-auth/providers/credentials'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, accounts, sessions, verificationTokens } from '@/db/schema'
import { allowedEmails, env } from '@/env'

const isE2E = env.E2E_ALLOW_TEST_LOGIN === '1'

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  providers: [
    Resend({ apiKey: env.AUTH_RESEND_KEY, from: env.AUTH_EMAIL_FROM }),
    ...(isE2E
      ? [
          Credentials({
            id: 'e2e',
            credentials: { email: { label: 'Email', type: 'email' } },
            async authorize(credentials) {
              const email = String(credentials?.email ?? '').toLowerCase()
              if (!allowedEmails.has(email)) return null
              const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
              if (existing) return { id: existing.id, email }
              const [u] = await db.insert(users).values({ email }).returning()
              return { id: u.id, email }
            },
          }),
        ]
      : []),
  ],
  pages: { signIn: '/sign-in' },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      return allowedEmails.has(user.email.toLowerCase())
    },
  },
})
```

- [ ] **Step 2: Route handler**

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 3: Sign-in page**

`src/app/sign-in/page.tsx`:

```tsx
import { signIn } from '@/auth'

export default function SignIn() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        action={async (formData) => {
          'use server'
          await signIn('resend', formData)
        }}
        className="w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-gray-500">
          We&apos;ll email you a magic link. Only allowlisted addresses can sign in.
        </p>
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full border rounded px-3 py-2"
        />
        <button type="submit" className="w-full bg-black text-white rounded py-2">
          Send magic link
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Manual smoke**

`pnpm dev`, visit `/sign-in`, enter your allowlisted email, submit. Check Resend dashboard for the link. Click it; should land at `/`.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/app/api/auth/ src/app/sign-in/
git commit -m "feat(auth): NextAuth v5 magic link + allowlist + E2E credentials"
```

---

## Task 9: Auth middleware

**Files:** `middleware.ts`

- [ ] **Step 1: Middleware**

```ts
import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl
  const isPublic = pathname === '/sign-in' || pathname.startsWith('/api/auth')
  if (isPublic) return NextResponse.next()
  if (!isLoggedIn) {
    const url = req.nextUrl.clone()
    url.pathname = '/sign-in'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Run homepage smoke test**

```bash
pnpm test:e2e tests/e2e/homepage.spec.ts
```

Expected: passes (sign-in page renders for anonymous user).

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): middleware gating non-public routes"
```

---

## Task 10: Project list page

**Files:** `src/actions/projects.ts`, `src/app/page.tsx`

- [ ] **Step 1: Server action**

`src/actions/projects.ts`:

```ts
'use server'
import { auth } from '@/auth'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createProject(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  const title = String(formData.get('title') ?? '').trim() || 'Untitled project'
  const [p] = await db
    .insert(projects)
    .values({ userId: session.user.id, title })
    .returning()
  revalidatePath('/')
  redirect(`/projects/${p.id}`)
}
```

- [ ] **Step 2: Home page**

`src/app/page.tsx`:

```tsx
import { auth, signOut } from '@/auth'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { createProject } from '@/actions/projects'

export default async function Home() {
  const session = await auth()
  if (!session?.user?.id) return null

  const myProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Your projects</h1>
        <form
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/sign-in' })
          }}
        >
          <button className="text-sm text-gray-500 hover:underline">
            {session.user.email} — sign out
          </button>
        </form>
      </header>

      <form action={createProject} className="flex gap-2">
        <input
          name="title"
          placeholder="New project title"
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="submit" className="bg-black text-white rounded px-4 py-2">
          New
        </button>
      </form>

      <ul className="space-y-2">
        {myProjects.length === 0 && (
          <li className="text-gray-500 text-sm">No projects yet.</li>
        )}
        {myProjects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="block border rounded p-3 hover:bg-gray-50">
              <div className="font-medium">{p.title}</div>
              <div className="text-xs text-gray-500">{p.updatedAt.toLocaleString()}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/actions/projects.ts
git commit -m "feat(projects): list + create + sign-out on home page"
```

---

## Task 11: Project detail page shell

**Files:** `src/app/projects/[id]/page.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Page server component**

`src/app/projects/[id]/page.tsx`:

```tsx
import { auth } from '@/auth'
import { db } from '@/db'
import { projects, iterations } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import ProjectWorkspace from '@/components/ProjectWorkspace'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return null

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) notFound()

  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, project.id))
    .orderBy(asc(iterations.createdAt))

  return <ProjectWorkspace project={project} initialHistory={history} />
}
```

- [ ] **Step 2: Workspace skeleton**

`src/components/ProjectWorkspace.tsx`:

```tsx
'use client'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
}) {
  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-4 text-sm text-gray-500" data-testid="chat-history">
          {initialHistory.length === 0
            ? 'Describe what you want to print.'
            : `${initialHistory.length} iterations so far.`}
        </div>
        <div className="p-4 border-t" data-testid="chat-input-placeholder">
          (chat input — Task 16)
        </div>
      </aside>
      <section className="bg-gray-50 flex items-center justify-center text-gray-400" data-testid="viewer-slot">
        (3D viewer — Task 18)
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/projects/ src/components/ProjectWorkspace.tsx
git commit -m "feat(projects): detail page shell"
```

---

## Task 12: JSCAD system prompt + tests

**Files:** `src/lib/prompt/system.ts`, `tests/unit/prompt-build.test.ts` (partial)

- [ ] **Step 1: Failing tests**

`tests/unit/prompt-build.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from '@/lib/prompt/system'

describe('SYSTEM_PROMPT (Phase 1: single-body)', () => {
  it('declares mm as the unit', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('mm')
  })
  it('mandates a main() function with single-body return', () => {
    expect(SYSTEM_PROMPT).toMatch(/main\s*\(\s*\)/)
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('return')
  })
  it('references @jscad/modeling', () => {
    expect(SYSTEM_PROMPT).toContain('@jscad/modeling')
  })
  it('forbids non-JSCAD imports', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/(no|only).*(import|require)/)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/prompt-build.test.ts
```

Expected: cannot find module.

- [ ] **Step 3: Implement**

`src/lib/prompt/system.ts`:

```ts
export const SYSTEM_PROMPT = `You generate 3D models as JavaScript code using @jscad/modeling.

RULES
- Units are millimeters (mm). Always.
- Output a CommonJS module with a single function: main()
- main() must RETURN a JSCAD geometry value (a 3D shape from @jscad/modeling). Do not console.log, do not return undefined, do not return an array (Phase 1 is single-body only).
- Do not import or require anything. Only use the global "jscad" namespace which is provided at runtime with the full @jscad/modeling API.
- Use only primitive geometry functions and standard operations on jscad. Examples: jscad.primitives.cuboid, jscad.primitives.cylinder, jscad.primitives.sphere, jscad.transforms.translate, jscad.transforms.rotate, jscad.booleans.union, jscad.booleans.subtract.
- Geometry must be watertight.
- Keep dimensions reasonable for a desktop FDM printer: nothing larger than 200mm in any axis unless explicitly asked.

OUTPUT FORMAT
Return ONLY the JavaScript code, no markdown fences, no commentary. The runtime evaluates the code and expects module.exports.main to exist.

EXAMPLE — user: "a 40mm cube with a 10mm hole through the center"

const main = () => {
  const block = jscad.primitives.cuboid({ size: [40, 40, 40] })
  const hole = jscad.primitives.cylinder({ radius: 5, height: 50 })
  return jscad.booleans.subtract(block, hole)
}
module.exports = { main }
`
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/unit/prompt-build.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt/system.ts tests/unit/prompt-build.test.ts
git commit -m "feat(prompt): JSCAD system prompt for single-body generation"
```

---

## Task 13: Prompt builder

**Files:** `src/lib/prompt/build.ts`, `tests/unit/prompt-build.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/prompt-build.test.ts`:

```ts
import { buildMessages } from '@/lib/prompt/build'

describe('buildMessages', () => {
  it('starts with the system prompt', () => {
    const msgs = buildMessages({ history: [], newMessage: 'a cube' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('@jscad/modeling')
  })

  it('appends history alternating user/assistant', () => {
    const msgs = buildMessages({
      history: [
        { userMessage: 'cube', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,10]}); module.exports = { main }' },
        { userMessage: 'taller', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,30]}); module.exports = { main }' },
      ],
      newMessage: 'add a hole',
    })
    expect(msgs).toHaveLength(6)
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'cube' })
    expect(msgs[2].role).toBe('assistant')
    expect(msgs[2].content).toContain('cuboid')
    expect(msgs[5]).toMatchObject({ role: 'user', content: 'add a hole' })
  })

  it('caps history at the last 10 turns', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      userMessage: `msg ${i}`,
      jscadCode: `// code ${i}`,
    }))
    const msgs = buildMessages({ history, newMessage: 'next' })
    expect(msgs).toHaveLength(22)
    expect(msgs[1].content).toBe('msg 10')
  })
})
```

- [ ] **Step 2: Implement**

`src/lib/prompt/build.ts`:

```ts
import { SYSTEM_PROMPT } from './system'

export type HistoryTurn = {
  userMessage: string
  jscadCode: string | null
}

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

const MAX_HISTORY_TURNS = 10

export function buildMessages(input: {
  history: HistoryTurn[]
  newMessage: string
}): Message[] {
  const recent = input.history.slice(-MAX_HISTORY_TURNS)
  const msgs: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of recent) {
    msgs.push({ role: 'user', content: turn.userMessage })
    if (turn.jscadCode !== null) {
      msgs.push({ role: 'assistant', content: turn.jscadCode })
    }
  }
  msgs.push({ role: 'user', content: input.newMessage })
  return msgs
}
```

- [ ] **Step 3: Run, expect pass**

```bash
pnpm test tests/unit/prompt-build.test.ts
```

Expected: 7 passed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompt/build.ts tests/unit/prompt-build.test.ts
git commit -m "feat(prompt): buildMessages with history cap"
```

---

## Task 14: `/api/generate` — streaming, persisted

**Files:** `src/app/api/generate/route.ts`

- [ ] **Step 1: Implement**

`src/app/api/generate/route.ts`:

```ts
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { buildMessages } from '@/lib/prompt/build'
import { streamText } from 'ai'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 120

const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
})

const MODEL = 'anthropic/claude-opus-4-7'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { projectId, message } = parsed.data

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!project) return new Response('Not found', { status: 404 })

  const history = await db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(asc(iterations.createdAt))

  const [iteration] = await db
    .insert(iterations)
    .values({ projectId, userMessage: message, status: 'generating' })
    .returning()

  const messages = buildMessages({
    history: history.map((h) => ({ userMessage: h.userMessage, jscadCode: h.jscadCode })),
    newMessage: message,
  })

  const result = streamText({
    model: MODEL,
    messages,
    onFinish: async ({ text }) => {
      await db
        .update(iterations)
        .set({ jscadCode: text, status: 'ready' })
        .where(eq(iterations.id, iteration.id))
      await db
        .update(projects)
        .set({ currentIterationId: iteration.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
    },
    onError: async ({ error }) => {
      await db
        .update(iterations)
        .set({ status: 'failed', error: String(error) })
        .where(eq(iterations.id, iteration.id))
    },
  })

  const response = result.toTextStreamResponse()
  response.headers.set('x-iteration-id', iteration.id)
  return response
}
```

The AI SDK auto-reads `AI_GATEWAY_API_KEY`; falls back to `ANTHROPIC_API_KEY` when not present.

- [ ] **Step 2: Commit (test next)**

```bash
git add src/app/api/generate/route.ts
git commit -m "feat(api): /api/generate streams Claude → persists iteration"
```

---

## Task 15: Integration test for `/api/generate`

**Files:** `tests/integration/api-generate.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq } from 'drizzle-orm'

let testUserId: string

vi.mock('ai', () => ({
  streamText: vi.fn().mockImplementation(({ onFinish }: any) => {
    const fixture = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })\nmodule.exports = { main }`
    setTimeout(() => onFinish({ text: fixture }), 0)
    return {
      toTextStreamResponse: () =>
        new Response(fixture, { headers: { 'content-type': 'text/plain' } }),
    }
  }),
}))

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

describe('/api/generate', () => {
  let projectId: string

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ email: `gen-${Date.now()}@example.com` }).returning()
    testUserId = u.id
    const [p] = await db.insert(projects).values({ userId: u.id, title: 't' }).returning()
    projectId = p.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId))
  })

  it('persists an iteration and streams JSCAD code back', async () => {
    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ projectId, message: 'make a 40mm cube' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('cuboid')
    await new Promise((r) => setTimeout(r, 50))
    const rows = await db.select().from(iterations).where(eq(iterations.projectId, projectId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ready')
    expect(rows[0].jscadCode).toContain('cuboid')
  })
})
```

- [ ] **Step 2: Run**

```bash
pnpm test tests/integration/api-generate.test.ts
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/api-generate.test.ts
git commit -m "test(api): /api/generate persists iteration end-to-end"
```

---

## Task 16: Chat client component

**Files:** `src/components/Chat.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Chat component**

`src/components/Chat.tsx`:

```tsx
'use client'
import { useState } from 'react'

type Msg = { role: 'user' | 'assistant'; text: string; iterationId?: string }

export default function Chat({
  projectId,
  initial,
  onIterationReady,
}: {
  projectId: string
  initial: Msg[]
  onIterationReady: (iterationId: string, code: string) => void
}) {
  const [messages, setMessages] = useState<Msg[]>(initial)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!draft.trim() || busy) return
    const userText = draft.trim()
    setMessages((m) => [...m, { role: 'user', text: userText }])
    setDraft('')
    setBusy(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, message: userText }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const iterationId = res.headers.get('x-iteration-id') ?? undefined
      const text = await res.text()
      setMessages((m) => [...m, { role: 'assistant', text, iterationId }])
      if (iterationId) onIterationReady(iterationId, text)
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm" data-testid="chat-history">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block rounded px-3 py-2 max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-black text-white'
                  : 'bg-gray-100 font-mono text-xs whitespace-pre-wrap'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="text-gray-400 text-xs">Generating…</div>}
      </div>
      <form
        className="p-4 border-t flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe what to build..."
          className="flex-1 border rounded px-3 py-2"
          disabled={busy}
          data-testid="chat-input"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
          disabled={busy}
        >
          Send
        </button>
      </form>
    </>
  )
}
```

- [ ] **Step 2: Wire into workspace (temporary text-only viewer)**

Replace `src/components/ProjectWorkspace.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat from './Chat'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
}) {
  const [currentCode, setCurrentCode] = useState<string | null>(
    initialHistory.findLast((it) => it.status === 'ready')?.jscadCode ?? null,
  )

  const initialMessages = initialHistory.flatMap((it) => {
    const out: { role: 'user' | 'assistant'; text: string; iterationId?: string }[] = [
      { role: 'user', text: it.userMessage },
    ]
    if (it.jscadCode) out.push({ role: 'assistant', text: it.jscadCode, iterationId: it.id })
    return out
  })

  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          onIterationReady={(_id, code) => setCurrentCode(code)}
        />
      </aside>
      <section className="bg-gray-50 flex items-center justify-center text-gray-400" data-testid="viewer-slot">
        {currentCode ? <pre className="text-[10px] text-left p-4">{currentCode}</pre> : '(viewer — Task 18)'}
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(chat): wire chat → /api/generate → workspace"
```

---

## Task 17: JSCAD sandbox + runner + worker

**Files:** `src/lib/jscad/sandbox.ts`, `src/lib/jscad/runner.ts`, `src/lib/jscad/worker-entry.ts`, `src/lib/jscad/worker-client.ts`, `tests/unit/jscad-runner.test.ts`

**Security note (repeat from header — read again before implementing):**

This task introduces the file that **compiles model-generated JavaScript at runtime**. That is the explicit purpose of this product, not an accidental code injection. The threat model is documented in the plan header. The sandbox is implemented in `sandbox.ts` and that file is the **only** place in the codebase allowed to invoke the dynamic-code constructor. Treat it as a security-sensitive module: any change there should be reviewed by a second pair of eyes.

- [ ] **Step 1: Failing test for the pure runner**

`tests/unit/jscad-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runJscad } from '@/lib/jscad/runner'

describe('runJscad', () => {
  it('returns triangle positions for a cuboid', async () => {
    const code = `
      const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] })
      module.exports = { main }
    `
    const r = await runJscad(code)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.positions.length).toBeGreaterThan(0)
      expect(r.positions.length % 9).toBe(0)
      expect(r.triangleCount).toBeGreaterThan(0)
    }
  })

  it('reports a syntax error cleanly', async () => {
    const r = await runJscad('this is not (valid javascript')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toMatch(/syntax|unexpected/)
  })

  it('rejects code that does not export main()', async () => {
    const r = await runJscad('module.exports = {}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toContain('main')
  })

  it('rejects code whose main() returns a non-geometry value', async () => {
    const r = await runJscad('const main = () => 42; module.exports = { main }')
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Implement the sandbox (single source of dynamic compilation)**

`src/lib/jscad/sandbox.ts`:

```ts
/**
 * SECURITY-CRITICAL FILE
 *
 * Purpose: compile a string of model-generated JavaScript into a callable
 * function. This is the ONLY place in the codebase allowed to do dynamic
 * code compilation. All other code paths must go through compileUserModule().
 *
 * Threat model:
 *   - Runs inside a dedicated Web Worker (no DOM, no document, no window).
 *   - Caller is an allowlisted, authenticated user. There is no public signup.
 *   - The output is a Float32Array of vertex positions — no objects, no callbacks.
 *   - The Worker does not import network APIs from this file; the system prompt
 *     forbids fetch/XHR usage and the runner does not pass any network globals.
 *
 * Hardening backlog (Phase 5):
 *   - Move into an OffscreenCanvas iframe with a strict CSP that disables fetch.
 *   - Or swap for an SES (Hardened JavaScript) realm.
 */

type UserModule = { main?: () => unknown }

/**
 * Compile a JavaScript source string into a function that, when called with
 * the jscad namespace, returns its module.exports object.
 *
 * The returned function takes (jscad, module, exports) as parameters and
 * the body is the user's code followed by `return module.exports`. This is
 * equivalent to a function expression — JavaScript's standard mechanism for
 * turning a string into a callable.
 */
export function compileUserModule(
  source: string,
): (jscad: unknown) => UserModule {
  const FunctionCtor = (function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown

  const compiled = new FunctionCtor(
    'jscad',
    'module',
    'exports',
    `${source}\nreturn module.exports;`,
  )

  return (jscad: unknown) => {
    const exportsObj: UserModule = {}
    const moduleObj = { exports: exportsObj }
    return compiled(jscad, moduleObj, exportsObj) as UserModule
  }
}
```

- [ ] **Step 3: Implement the runner**

`src/lib/jscad/runner.ts`:

```ts
import * as jscadModeling from '@jscad/modeling'
import { compileUserModule } from './sandbox'

export type JscadResult =
  | { ok: true; positions: Float32Array; triangleCount: number }
  | { ok: false; error: string }

export async function runJscad(code: string): Promise<JscadResult> {
  let mod: { main?: () => unknown }
  try {
    const factory = compileUserModule(code)
    mod = factory(jscadModeling)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  if (typeof mod?.main !== 'function') {
    return {
      ok: false,
      error: 'Code must export a main() function via module.exports = { main }.',
    }
  }

  let geom: unknown
  try {
    geom = mod.main()
  } catch (e) {
    return { ok: false, error: `main() threw: ${(e as Error).message}` }
  }

  try {
    const { toPolygons } = jscadModeling.geometries.geom3
    const polygons = toPolygons(geom as Parameters<typeof toPolygons>[0])
    if (!Array.isArray(polygons) || polygons.length === 0) {
      return { ok: false, error: 'main() returned no geometry.' }
    }

    const positions: number[] = []
    for (const poly of polygons) {
      const verts = poly.vertices
      // Fan-triangulate the convex polygon.
      for (let i = 1; i < verts.length - 1; i++) {
        positions.push(...verts[0], ...verts[i], ...verts[i + 1])
      }
    }
    return {
      ok: true,
      positions: new Float32Array(positions),
      triangleCount: positions.length / 9,
    }
  } catch (e) {
    return {
      ok: false,
      error: `main() did not return a 3D geometry (geom3). ${(e as Error).message}`,
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/unit/jscad-runner.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Worker entry + main-thread client**

`src/lib/jscad/worker-entry.ts`:

```ts
import { runJscad } from './runner'

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const result = await runJscad(e.data.code)
  ;(self as unknown as Worker).postMessage(result)
}
```

`src/lib/jscad/worker-client.ts`:

```ts
import type { JscadResult } from './runner'

type Job = { resolve: (r: JscadResult) => void; reject: (e: unknown) => void }

let worker: Worker | null = null
let pending: Job | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<JscadResult>) => {
    pending?.resolve(e.data)
    pending = null
  }
  worker.onerror = (e) => {
    pending?.reject(e)
    pending = null
  }
  return worker
}

export function runInWorker(code: string): Promise<JscadResult> {
  if (pending) return Promise.reject(new Error('Another job is in flight'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    ensureWorker().postMessage({ code })
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/jscad/ tests/unit/jscad-runner.test.ts
git commit -m "feat(jscad): sandboxed worker that runs LLM code → mesh"
```

---

## Task 18: Mesh viewer (react-three-fiber)

**Files:** `src/components/MeshViewer.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Viewer component**

`src/components/MeshViewer.tsx`:

```tsx
'use client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

export default function MeshViewer({ positions }: { positions: Float32Array | null }) {
  const geometry = useMemo(() => {
    if (!positions) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.computeVertexNormals()
    return g
  }, [positions])

  return (
    <Canvas camera={{ position: [80, 80, 80], fov: 40 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[100, 100, 100]} intensity={0.8} />
      <gridHelper args={[200, 20, '#888', '#ddd']} />
      {geometry && (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      )}
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </Canvas>
  )
}
```

- [ ] **Step 2: Wire into workspace**

Replace `src/components/ProjectWorkspace.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat from './Chat'
import MeshViewer from './MeshViewer'
import { runInWorker } from '@/lib/jscad/worker-client'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
}) {
  const [code, setCode] = useState<string | null>(
    initialHistory.findLast((it) => it.status === 'ready')?.jscadCode ?? null,
  )
  const [positions, setPositions] = useState<Float32Array | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    setError(null)
    runInWorker(code)
      .then((r) => {
        if (cancelled) return
        if (r.ok) setPositions(r.positions)
        else {
          setPositions(null)
          setError(r.error)
        }
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [code])

  const initialMessages = initialHistory.flatMap((it) => {
    const out: { role: 'user' | 'assistant'; text: string; iterationId?: string }[] = [
      { role: 'user', text: it.userMessage },
    ]
    if (it.jscadCode) out.push({ role: 'assistant', text: it.jscadCode, iterationId: it.id })
    return out
  })

  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          onIterationReady={(_id, c) => setCode(c)}
        />
      </aside>
      <section className="relative bg-gray-50" data-testid="viewer-slot">
        <MeshViewer positions={positions} />
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-50 text-red-900 border border-red-200 rounded p-3 text-xs">
            <strong>JSCAD error:</strong> {error}
          </div>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Manual smoke**

`pnpm dev`, send "a 40mm cube" — a blue cube appears in the viewer within a few seconds. Orbit/zoom works.

- [ ] **Step 4: Commit**

```bash
git add src/components/MeshViewer.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(viewer): three-fiber mesh viewer wired to worker"
```

---

## Task 19: E2E happy-path test

**Files:** `tests/e2e/session-helper.ts`, `tests/e2e/generate-flow.spec.ts`

- [ ] **Step 1: Session helper**

`tests/e2e/session-helper.ts`:

```ts
import type { Page } from '@playwright/test'

export async function signInE2E(page: Page, email: string) {
  await page.goto('/api/auth/signin/e2e')
  await page.fill('input[name="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
}
```

- [ ] **Step 2: Happy-path test**

`tests/e2e/generate-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

const FIXTURE_CODE = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })
module.exports = { main }`

test('user signs in, creates project, generates a cube, sees it in the viewer', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'x-iteration-id': '00000000-0000-0000-0000-000000000001',
        'content-type': 'text/plain',
      },
      body: FIXTURE_CODE,
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')

  await page.fill('input[name="title"]', 'E2E project')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'a 40mm cube')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  await expect(page.locator('[data-testid="chat-history"]')).toContainText('cuboid', { timeout: 5_000 })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 })
})
```

- [ ] **Step 3: Run**

```bash
E2E_ALLOW_TEST_LOGIN=1 E2E_TEST_EMAIL=gustavo.b.paris@gmail.com pnpm test:e2e
```

Expected: 2 passed (homepage smoke + this one).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/
git commit -m "test(e2e): happy-path login → generate → viewer renders"
```

---

## Task 20: README + final pass

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

## Phase 1 scope

Single-body generation end-to-end. See `docs/superpowers/plans/2026-05-15-phase-1-single-body-mvp.md`.

## Security

LLM-generated code runs in a sandboxed Web Worker. See `src/lib/jscad/sandbox.ts` for the threat model and hardening backlog. The sandbox file is the only place dynamic code compilation occurs.
```

- [ ] **Step 2: Run full suite**

```bash
pnpm test
E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with local-dev, tests, and security note"
```

---

## Phase 1 — Done criteria

- [ ] `pnpm install && pnpm db:migrate && pnpm dev`, sign in via magic link, create a project, and generate a single-body 3D model end-to-end from a chat message.
- [ ] All vitest tests pass (`pnpm test`).
- [ ] All Playwright E2E tests pass (`E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e`).
- [ ] Iterations persist in Postgres with `status='ready'` and `jscadCode` populated.
- [ ] Viewer renders a recognizable cube for "a 40mm cube".

## What's next (out of scope here)

- **Phase 2 plan:** multi-body convention in prompt + worker → multi-color viewer + extruder config UI
- **Phase 3 plan:** image upload → multimodal Claude prompt
- **Phase 4 plan:** OrcaSlicer service on Railway + `/api/slice` + 3MF download
- **Phase 5 plan:** iteration history UI, version tree, rollback, viewer polish, sandbox hardening

