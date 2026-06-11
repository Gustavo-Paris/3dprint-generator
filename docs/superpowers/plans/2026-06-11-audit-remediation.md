# Audit v1 Remediation + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every audit finding (2 P0, ~18 P1, ~20 P2) and bring the generate→preview→slice→export loop to a premium feel; no new capability.

**Architecture:** Approach A — foundation-first. Phase 0 (operator) → 1 ship-blockers → 2 quality gate → 3 core-loop correctness → 4 backend/security → 5 data → 6 architecture → 7 performance → 8 UX/PT-BR. Each task is committed independently; (structural)/(destructive) tasks pause for a checkpoint at execution time.

**Tech Stack:** Next.js 16 (App Router, Turbopack), NextAuth v5 (db sessions), Drizzle/Postgres, React 19, three.js/@react-three/fiber + drei, jscad/manifold mesh ops, Orca slicer microservice (slicer/, Railway), Vercel Blob, vitest 4, playwright, pnpm 9.

**Spec:** docs/superpowers/specs/2026-06-11-audit-remediation-design.md · **Base sha:** 8671cc4 (audit at this sha)

**Conventions:** per-task commit, verbatim trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, never `--no-verify`, explicit staging. UI strings PT-BR; code/comments English.

---

## Phase 0 — Operator actions (Wave 0, NOT code)

These are done by the operator, not the executor. The arc does not perform them.

- [ ] **Rotate `AUTH_RESEND_KEY` and `MESHY_API_KEY`** — both were pasted in chat and are flagged for rotation (verified absent from git history, so this is out-of-band exposure only). Rotate at resend.com and meshy.ai, update the Railway env and local `.env.local`.
- [ ] **Confirm `AUTH_TRUST_HOST=true` (or `AUTH_URL`) in the Railway env** — belt-and-suspenders for the Task 1.1 code fix. Without either, NextAuth v5 throws `UntrustedHost` under a non-Vercel prod and blanks the app.

---

I have everything I need. The repo uses `node` env in vitest (no DOM by default), `jsdom` is installed but not configured. For the UUID validation I'll extract a pure helper and unit-test it (node env, no DOM needed). For the responsive grid I'll use a Playwright headless probe. For auth I'll use a prod-build curl probe. Now I'll write the plan.

## Phase 1 — Ship-blockers (P0)

**Goal:** Make the deployed app actually usable — fix prod auth (UntrustedHost blanks the app for everyone), make the workspace responsive at 390px so the 3D viewer is reachable, and stop `/projects/<non-uuid>` from 500-ing with a SQL leak.

---

### Task 1.1: Add `trustHost: true` to the NextAuth config (structural)

This is the root P0: under `next start`, NextAuth v5 throws `UntrustedHost` on every `auth()`, so `session?.user?.id` is always falsy and every page falls through to `return null` — the authed home is byte-identical to logged-out. No unit test can assert `trustHost` (it only manifests in a server runtime), so verification is a prod-build curl probe done in Task 1.3 after the page redirects are in place. This task is the isolated config change.

**Files:**
- Modify: `src/auth.ts:12-19`

- [ ] **Step 1: Implement** — in `src/auth.ts`, add `trustHost: true` as the first option inside `NextAuth({...})`. Current code (verified `src/auth.ts:12-19`):

  ```ts
  export const { handlers, signIn, signOut, auth } = NextAuth({
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: 'database' },
  ```

  Change to:

  ```ts
  export const { handlers, signIn, signOut, auth } = NextAuth({
    // Required under `next start` (and Railway): NextAuth v5 otherwise throws
    // UntrustedHost on every auth() because it can't infer the deployment URL,
    // which silently blanks the whole app. AUTH_TRUST_HOST in the env is the belt.
    trustHost: true,
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: 'database' },
  ```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` — Expected: PASS (no new errors; `trustHost` is a valid `NextAuthConfig` key).

- [ ] **Step 3: Commit** — `git add src/auth.ts` then `git commit -m "fix(auth): set trustHost to fix prod UntrustedHost on every auth()"` (trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 1.2: Redirect unauthenticated users to `/sign-in` instead of rendering blank (structural)

`src/app/page.tsx:10` and `src/app/projects/[id]/page.tsx:15` both do `if (!session?.user?.id) return null` — once `trustHost` makes `auth()` resolve, an unauth visitor still gets a blank page instead of being sent to sign-in. Switch both to `redirect('/sign-in')`. `redirect` comes from `next/navigation` (same module already used for `notFound` at `src/app/projects/[id]/page.tsx:5`). This is defense-in-depth alongside `middleware.ts` (which already redirects via `auth((req) => …)` at `middleware.ts:4-15` and now works once `auth()` resolves) — keep both.

**Files:**
- Modify: `src/app/page.tsx:1,9-10`
- Modify: `src/app/projects/[id]/page.tsx:5,14-15`

- [ ] **Step 1: Implement (home)** — in `src/app/page.tsx`, add `redirect` to the existing `next/...` imports and swap the guard. Current (verified `src/app/page.tsx:1,8-10`):

  ```ts
  import Link from 'next/link'
  ```
  ```ts
  export default async function Home() {
    const session = await auth()
    if (!session?.user?.id) return null
  ```

  Change to:

  ```ts
  import Link from 'next/link'
  import { redirect } from 'next/navigation'
  ```
  ```ts
  export default async function Home() {
    const session = await auth()
    if (!session?.user?.id) redirect('/sign-in')
  ```

- [ ] **Step 2: Implement (project page)** — in `src/app/projects/[id]/page.tsx`, extend the existing `next/navigation` import and swap the guard. Current (verified `src/app/projects/[id]/page.tsx:5,13-15`):

  ```ts
  import { notFound } from 'next/navigation'
  ```
  ```ts
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) return null
  ```

  Change to:

  ```ts
  import { notFound, redirect } from 'next/navigation'
  ```
  ```ts
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) redirect('/sign-in')
  ```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` — Expected: PASS. Note `redirect()` returns `never`, so TypeScript narrows correctly; `session.user.id` below the guard stays non-null.

- [ ] **Step 4: Commit** — `git add src/app/page.tsx src/app/projects/[id]/page.tsx` then `git commit -m "fix(auth): redirect unauth users to /sign-in instead of blank render"` (trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 1.3: Prod-build smoke probe — verify auth resolves and redirects work

No unit test can cover `trustHost`; this is the acceptance probe for Tasks 1.1–1.2. Run against a real production build. Requires a valid `.env.local` (DATABASE_URL etc.) and a seeded allowed-email user with a DB session cookie. Use port 3001 to avoid colliding with `pnpm dev`.

**Files:** (verification only — no code change)

- [ ] **Step 1: Build & start prod** — run the build then start on 3001:

  ```bash
  pnpm build && PORT=3001 pnpm start
  ```
  Expected: build completes, server logs `Ready` / listening on `:3001`. Run this in a background shell (or a second terminal) so the probes below can hit it.

- [ ] **Step 2: Probe unauth `/`** — 

  ```bash
  curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3001/
  ```
  Expected: `307 http://localhost:3001/sign-in` (the middleware/page redirect fires — NOT `200` with a blank body).

- [ ] **Step 3: Probe `/sign-in` reachable** —

  ```bash
  curl -sS http://localhost:3001/sign-in | grep -ci "sign in"
  ```
  Expected: `>= 1` (sign-in page renders; `h1` contains "Sign in", consistent with `tests/e2e/homepage.spec.ts:5`).

- [ ] **Step 4: Probe authed `/`** — grab a session cookie (via the e2e test-login route with `E2E_ALLOW_TEST_LOGIN=1`, or copy `authjs.session-token` from a logged-in browser) and request `/` with it:

  ```bash
  curl -sS --cookie "authjs.session-token=<TOKEN>" http://localhost:3001/ | grep -c "Your projects"
  ```
  Expected: `>= 1` — the project list renders (`<h1>Your projects</h1>` from `src/app/page.tsx:21`), proving `auth()` now resolves and the page is NOT byte-identical to the logged-out redirect. If this returns `0`, `trustHost` is not taking effect — re-check Task 1.1.

- [ ] **Step 5: No commit** — verification-only; nothing to commit. Stop the prod server when done.

---

### Task 1.4: Validate the project `id` param as a UUID before querying (extract pure helper)

`src/app/projects/[id]/page.tsx` passes the raw route param straight into `eq(projects.id, id)` where `projects.id` is a `uuid` column (verified `src/db/schema.ts:48`). A non-uuid param makes Postgres throw `invalid input syntax for type uuid`, surfacing as a 500 with a SQL fragment in the message (masked today by P0-1, surfaces once auth resolves). Fix: validate with `z.string().uuid()` and `notFound()` before touching the DB. Extract the check into a tiny pure helper so it's unit-testable in the `node` vitest env (verified `vitest.config.ts:8` `environment: 'node'`; zod 4 is a dep per `package.json`).

**Files:**
- Create: `src/lib/validation/uuid.ts`
- Modify: `src/app/projects/[id]/page.tsx:13-22`
- Test: `tests/unit/uuid-validation.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/unit/uuid-validation.test.ts` (matches the repo's `describe/it/expect` + `@/` alias style, e.g. `tests/unit/stl-parser.test.ts`):

  ```ts
  import { describe, it, expect } from 'vitest'
  import { isUuid } from '@/lib/validation/uuid'

  describe('isUuid', () => {
    it('accepts a canonical v4 uuid', () => {
      expect(isUuid('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true)
    })

    it('rejects a non-uuid route param', () => {
      expect(isUuid('not-a-uuid')).toBe(false)
    })

    it('rejects empty string and obvious junk', () => {
      expect(isUuid('')).toBe(false)
      expect(isUuid('123')).toBe(false)
      expect(isUuid('../../etc/passwd')).toBe(false)
    })

    it('rejects a uuid with surrounding whitespace', () => {
      expect(isUuid(' a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d ')).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/uuid-validation.test.ts` — Expected: FAIL with a resolution error (`Cannot find module '@/lib/validation/uuid'` / `isUuid is not a function`) because the helper does not exist yet.

- [ ] **Step 3: Implement** — create `src/lib/validation/uuid.ts`:

  ```ts
  import { z } from 'zod'

  const uuidSchema = z.string().uuid()

  /** True when `value` is a canonical UUID — use to guard `uuid` DB columns. */
  export function isUuid(value: string): boolean {
    return uuidSchema.safeParse(value).success
  }
  ```

  Then wire it into `src/app/projects/[id]/page.tsx`. Current (verified `:5,13-22`):

  ```ts
  import { notFound, redirect } from 'next/navigation'
  ```
  ```ts
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) redirect('/sign-in')

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
      .limit(1)
    if (!project) notFound()
  ```

  Change to (add the import and the guard before the query):

  ```ts
  import { notFound, redirect } from 'next/navigation'
  import { isUuid } from '@/lib/validation/uuid'
  ```
  ```ts
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) redirect('/sign-in')

    // `projects.id` is a uuid column — a non-uuid param makes Postgres throw
    // (500 + SQL leak). Treat malformed ids as not-found.
    if (!isUuid(id)) notFound()

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
      .limit(1)
    if (!project) notFound()
  ```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/uuid-validation.test.ts` — Expected: PASS (4 assertions green).

- [ ] **Step 5: Commit** — `git add src/lib/validation/uuid.ts src/app/projects/[id]/page.tsx tests/unit/uuid-validation.test.ts` then `git commit -m "fix(projects): 404 on non-uuid id instead of 500 + SQL leak"` (trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 1.5: Make the workspace responsive — stack on mobile, grid on `lg` (structural)

`src/components/ProjectWorkspace.tsx:281` hardcodes `h-screen grid grid-cols-[420px_1fr]` with no breakpoint, so at 390px the 420px chat column shoves the `viewer-slot` `<section>` (line 296) off-screen. Switch to a column flex stack that promotes to the two-column grid at `lg`. Constrain the chat aside's height so it doesn't eat the full viewport on mobile.

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx:281-296`

- [ ] **Step 1: Implement** — in `src/components/ProjectWorkspace.tsx`, change the `<main>` and the two children's responsive classes. Current (verified `:281-296`):

  ```tsx
  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          initialAttachedImageUrl={lastImageUrl}
          onResult={onResult}
          onMeshUploaded={onMeshUploaded}
          pendingMeshUrl={pendingMeshUrl}
          pendingPreviews={pendingPreviews}
        />
      </aside>
      <section className="relative bg-gray-50" data-testid="viewer-slot">
  ```

  Change to:

  ```tsx
  return (
    <main className="h-screen flex flex-col lg:grid lg:grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0 max-h-[45vh] lg:max-h-none">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          initialAttachedImageUrl={lastImageUrl}
          onResult={onResult}
          onMeshUploaded={onMeshUploaded}
          pendingMeshUrl={pendingMeshUrl}
          pendingPreviews={pendingPreviews}
        />
      </aside>
      <section className="relative bg-gray-50 flex-1 min-h-0" data-testid="viewer-slot">
  ```

  (`flex-1 min-h-0` on the viewer section ensures it claims the remaining vertical space in the mobile stack; `max-h-[45vh]` caps the chat so the viewer is visible without scrolling. At `lg` the `lg:grid` wins and the heights reset to the original two-column layout.)

- [ ] **Step 2: Verify at 390px via a Playwright headless probe** — the workspace mounts R3F/three.js and needs an authed session, so assert layout geometry with the existing e2e harness rather than a unit test. Add a temporary spec (delete after) or run inline; the canonical probe (uses `signInE2E` from `tests/e2e/session-helper.ts` and the `viewer-slot` testid):

  ```ts
  // tests/e2e/workspace-responsive.spec.ts (probe — remove after verifying)
  import { test, expect } from '@playwright/test'
  import { signInE2E } from './session-helper'

  test('viewer slot stays within a 390px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signInE2E(page, 'gustavo.b.paris@gmail.com') // must be in AUTH_ALLOWED_EMAILS
    // open the first project from the home list
    await page.locator('a[href^="/projects/"]').first().click()
    const viewer = page.getByTestId('viewer-slot')
    await expect(viewer).toBeVisible()
    const box = await viewer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1) // within viewport, ~1px tolerance
    expect(box!.width).toBeGreaterThan(200) // not collapsed
  })
  ```

  Run: `pnpm test:e2e workspace-responsive` (the `webServer` block in `playwright.config.ts:11-17` boots `pnpm dev` with `E2E_ALLOW_TEST_LOGIN=1`). Expected: PASS — `viewer-slot` is visible and its right edge is `<= 390px` (before the fix it overflowed because the 420px grid column pushed it right). Requires at least one project to exist for the seeded user; create one via the home form first if the list is empty.

- [ ] **Step 3: Commit** — `git add src/components/ProjectWorkspace.tsx` then `git commit -m "fix(workspace): responsive stack so the 3D viewer is usable at 390px"` (trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`). Do not commit the throwaway probe spec — delete `tests/e2e/workspace-responsive.spec.ts` after verifying (a durable responsive e2e belongs to Phase 2's e2e rehab).

---

**Phase acceptance (all of Phase 1):** prod build (`pnpm build && PORT=3001 pnpm start`) — unauth `/` returns `307 → /sign-in` (Task 1.3 Step 2), authed `/` renders "Your projects" and is not byte-identical to logged-out (1.3 Step 4), `/projects/not-a-uuid` returns 404 not 500 (1.4), and `viewer-slot` is within the 390px viewport (1.5 Step 2). Full unit suite stays green: `pnpm test`.

---

I now have everything needed. Key grounding decisions:

- **Chat.tsx:156 is `const bb = body.meta.bbox_mm`** — line 153 already types `bbox_mm?` optional, line 157 already guards `bb ? ...`. The real crash is `body.meta` being `undefined` (legacy mock returns `{strategy, jscad_code}`, no `meta`). The guard must be `body.meta?.bbox_mm` and the type `meta?: {...}`.
- **No jsdom/testing-library** is installed and all tests run `environment: 'node'`. A React-render test for Chat would need new infra. The faithful TDD path is to extract the label-building logic into a pure helper (`src/lib/chat/result-label.ts`) and unit-test it in node — this also makes the `body.meta?.bbox_mm` guard directly testable. This matches the spec note (line 211: "the E2E copy assertions become the guard").
- E2E needs a DB-backed `next start` (test-login inserts users/sessions) — CI E2E is heavier; the spec's CI table lists e2e "against a built app" but the simpler-and-honest CI runs lint+tsc+unit on every push and gates e2e behind a Postgres service. I'll include e2e in CI as a job using a Postgres service container.

Here is the Phase 2 plan.

---

## Phase 2 — Quality-gate foundation

**Goal:** Make the test suite a trustworthy gate — E2E reads `E2E_BASE_URL` (so it stops hitting the unrelated `:3000` project), the 3 rotted specs match the real `/api/generate` contract, `Chat` no longer throws on a `meta`-less response, CI runs lint + tsc + unit + e2e on every push, and `pnpm test --coverage` enforces thresholds on the mesh/flexify/3mf libs.

---

### Task 2.1: Extract the chat result-label builder into a testable pure helper

The crash the spec attributes to `Chat.tsx:156` is `body.meta.bbox_mm` throwing when `body.meta` is `undefined` (the legacy mock returns `{ strategy, jscad_code }` with no `meta`). `Chat.tsx` is a `'use client'` React component and the repo has no jsdom/testing-library (all tests run `environment: 'node'`). Rather than add render infra, extract the label/dims logic (currently `Chat.tsx:156-163`) into a pure function so it is unit-testable in node and the `meta?` guard lives in one place.

**Files:**
- Create: `src/lib/chat/result-label.ts`
- Test: `tests/unit/chat/result-label.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/chat/result-label.test.ts
import { describe, it, expect } from 'vitest'
import { resultLabel, type GenerateMeta } from '@/lib/chat/result-label'

describe('resultLabel', () => {
  it('appends mm dims when meta.bbox_mm is present', () => {
    const meta: GenerateMeta = { kind: 'disc', bbox_mm: { x: 40, y: 40, z: 3 } }
    expect(resultLabel(meta)).toBe('Disco / medalha (40×40×3 mm)')
  })

  it('falls back to "Generated" with no dims when bbox_mm is missing', () => {
    expect(resultLabel({ kind: 'disc' })).toBe('Disco / medalha')
  })

  it('does not throw and returns "Generated" when meta itself is undefined (legacy/meta-less response)', () => {
    expect(resultLabel(undefined)).toBe('Generated')
  })

  it('labels hollow_cylinder and flat_plate kinds', () => {
    expect(resultLabel({ kind: 'hollow_cylinder', bbox_mm: { x: 70, y: 70, z: 100 } }))
      .toBe('Porta-lata / sleeve (70×70×100 mm)')
    expect(resultLabel({ kind: 'flat_plate', bbox_mm: { x: 50, y: 80, z: 4 } }))
      .toBe('Placa / chaveiro (50×80×4 mm)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/chat/result-label.test.ts` — Expected: FAIL (`Cannot find module '@/lib/chat/result-label'`)

- [ ] **Step 3: Implement** — extract the logic verbatim from `Chat.tsx:156-163`, hardening the `meta` access to optional:
```ts
// src/lib/chat/result-label.ts
export type GenerateMeta = {
  kind?: 'hollow_cylinder' | 'flat_plate' | 'disc'
  bbox_mm?: { x: number; y: number; z: number }
}

const LABEL_BY_KIND: Record<string, string> = {
  hollow_cylinder: 'Porta-lata / sleeve',
  flat_plate: 'Placa / chaveiro',
  disc: 'Disco / medalha',
}

/** Human label + mm dims for the chat assistant bubble. Tolerates a missing
 * `meta` or `bbox_mm` (legacy/meta-less responses) instead of throwing. */
export function resultLabel(meta: GenerateMeta | undefined): string {
  const bb = meta?.bbox_mm
  const dims = bb ? ` (${bb.x.toFixed(0)}×${bb.y.toFixed(0)}×${bb.z.toFixed(0)} mm)` : ''
  const base = (meta?.kind && LABEL_BY_KIND[meta.kind]) ?? 'Generated'
  return `${base}${dims}`
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/chat/result-label.test.ts` — Expected: PASS (4 tests)

- [ ] **Step 5: Commit** — `git add src/lib/chat/result-label.ts tests/unit/chat/result-label.test.ts` then `git commit -m "test(chat): extract result-label helper, guard meta-less responses"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.2: Wire `Chat.tsx` to the helper and harden the `meta` type (structural)

`(structural)` — narrows the response-shape contract `Chat` consumes: `meta` becomes optional. Replaces the inline label block at `Chat.tsx:156-163`; the spec's `body.meta.bbox_mm` becomes the safe `body.meta?.bbox_mm` via the helper.

**Files:**
- Modify: `src/components/Chat.tsx:143-163`

- [ ] **Step 1: No new test** — covered by `tests/unit/chat/result-label.test.ts` (2.1) and the E2E specs (2.4-2.6). The component is otherwise un-renderable in the node-only vitest env.

- [ ] **Step 2: Verification gate (type)** — `npx tsc --noEmit` — Expected: 0 errors (confirms the helper import + optional `meta` typecheck cleanly).

- [ ] **Step 3: Implement** — add the import near the top of `Chat.tsx` (the file currently imports only `useRef, useState` at line 2):
```ts
// src/components/Chat.tsx — add below line 2
import { resultLabel } from '@/lib/chat/result-label'
```
Make `meta` optional in the response type and replace the inline label logic. The current block reads (lines 143-163):
```ts
      const body = (await res.json()) as {
        strategy: 'generative'
        iteration_id: string
        mesh_url: string | null
        mesh_base64: string | null
        design?: unknown
        design_adjustments?: Array<{ field: string; from: number; to: number }>
        warnings?: Array<{ opIndex: number; op: string; reason: string }>
        meta: {
          kind?: 'hollow_cylinder' | 'flat_plate' | 'disc'
          bbox_mm?: { x: number; y: number; z: number }
        }
      }
      const bb = body.meta.bbox_mm
      const dims = bb ? ` (${bb.x.toFixed(0)}×${bb.y.toFixed(0)}×${bb.z.toFixed(0)} mm)` : ''
      const labelByKind: Record<string, string> = {
        hollow_cylinder: `Porta-lata / sleeve${dims}`,
        flat_plate: `Placa / chaveiro${dims}`,
        disc: `Disco / medalha${dims}`,
      }
      const label = (body.meta.kind && labelByKind[body.meta.kind]) ?? `Generated${dims}`
```
Replace with:
```ts
      const body = (await res.json()) as {
        strategy: 'generative'
        iteration_id: string
        mesh_url: string | null
        mesh_base64: string | null
        design?: unknown
        design_adjustments?: Array<{ field: string; from: number; to: number }>
        warnings?: Array<{ opIndex: number; op: string; reason: string }>
        meta?: {
          kind?: 'hollow_cylinder' | 'flat_plate' | 'disc'
          bbox_mm?: { x: number; y: number; z: number }
        }
      }
      const label = resultLabel(body.meta)
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit && pnpm lint` — Expected: 0 errors, 0 warnings (no more unused `bb`/`dims`/`labelByKind`).

- [ ] **Step 5: Commit** — `git add src/components/Chat.tsx` then `git commit -m "fix(chat): guard meta-less /api/generate responses via resultLabel helper"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.3: Make `playwright.config.ts` honor `E2E_BASE_URL` (structural)

`(structural)` — changes the E2E harness contract: `baseURL`, `webServer.url`, and `reuseExistingServer` now derive from `E2E_BASE_URL`. The current config hardcodes `http://localhost:3000` (lines 8, 13) where a *different* project runs on this machine; the spec acceptance targets `:3001`.

**Files:**
- Modify: `playwright.config.ts:1-19`

- [ ] **Step 1: No unit test** — config file; verified by the probe in Step 2 and by the green specs in 2.4-2.6.

- [ ] **Step 2: Verification probe** — confirm the env wiring resolves at config-load time:
```bash
E2E_BASE_URL=http://localhost:3001 node -e "import('./playwright.config.ts').then(m=>{const c=m.default;console.log(c.use.baseURL, c.webServer.url)})" 2>/dev/null \
  || npx playwright test --list 2>&1 | head -5
```
Expected: prints `http://localhost:3001 http://localhost:3001` (or `--list` resolves without the hardcoded `:3000`). Note: the `node -e` import may need `tsx`; the `--list` fallback is the reliable check.

- [ ] **Step 3: Implement** — the current file is 19 lines (shown below as-is for lines 7-17); rewrite to read the env var with a `:3001` default that matches the spec's local dev port, and only auto-reuse a server when the URL is the default localhost:
```ts
import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    // `next dev` on the configured port; CI overrides E2E_BASE_URL to a built app it starts itself.
    command: 'pnpm dev --port 3001',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { E2E_ALLOW_TEST_LOGIN: '1' },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
```
(`next dev` accepts `--port`; the CI job in 2.8 sets `E2E_BASE_URL` to a `next start` server it manages, so `reuseExistingServer` stays true there only when not `CI`.)

- [ ] **Step 4: Verify** — re-run the Step 2 probe — Expected: resolves to the `E2E_BASE_URL` value, no `:3000`.

- [ ] **Step 5: Commit** — `git add playwright.config.ts` then `git commit -m "test(e2e): read E2E_BASE_URL (default :3001) instead of hardcoding :3000"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.4: Fix `generate-flow.spec.ts` mock to the real `/api/generate` contract (structural)

`(structural)` — changes a shared test fixture's response shape. The current mock (`generate-flow.spec.ts:11-17`) returns the legacy `{ strategy:'parametric', iteration_id, jscad_code }` — but the real route (`src/app/api/generate/route.ts:355-367`) returns `{ strategy:'generative', iteration_id, mesh_url, mesh_base64, design, design_adjustments, warnings, meta:{ kind, bbox_mm } }`, and `Chat` renders the result via `onResult({ kind:'generative', meshUrl, meshBase64 })`. The legacy mock has no `meta`, no `mesh_*`, and the spec asserts chat history contains `'cuboid'` (no longer rendered — the label is `designSummary`/`resultLabel`, never the jscad source).

**Files:**
- Modify: `tests/e2e/generate-flow.spec.ts:1-31`

- [ ] **Step 1: This *is* the test** — rewrite the spec so the mock matches the real contract and the assertions match what `Chat` renders (`resultLabel` → "Disco / medalha (…)", the `meshy` strategy badge from `Chat.tsx:213`, and a visible canvas).

- [ ] **Step 2: Run to verify current FAIL** — `pnpm test:e2e tests/e2e/generate-flow.spec.ts` (with the app on `E2E_BASE_URL`) — Expected: FAIL — `chat-history` never contains `'cuboid'` (the UI shows the PT-BR label, and `body.meta` access path differs).

- [ ] **Step 3: Implement** — replace the mock + assertions. A parametric `disc` is the lightest real shape that yields a known label and a renderable mesh:
```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

test('user signs in, creates project, generates a parametric disc, sees it in the viewer', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Real /api/generate contract (src/app/api/generate/route.ts:355-367).
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000001',
        mesh_url: '/meshes/00000000-0000-0000-0000-000000000001.stl',
        mesh_base64: null,
        design: { kind: 'disc', diameterMm: 40, thicknessMm: 3 },
        design_adjustments: [],
        warnings: [],
        meta: { kind: 'disc', bbox_mm: { x: 40, y: 40, z: 3 } },
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')

  await page.fill('input[name="title"]', 'E2E project')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'a 40mm disc')
  await page.locator('[data-testid="chat-input"]').press('Enter')

  // Chat renders resultLabel(meta) → "Disco / medalha (40×40×3 mm)".
  await expect(page.locator('[data-testid="chat-history"]')).toContainText('Disco / medalha', { timeout: 10_000 })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
})
```
Note: the spec asserts `mesh_url` points at a local path. If the viewer cannot fetch a non-existent `/meshes/...stl` and the canvas fails to mount, fall back to asserting only the chat label (the mesh fetch is out of this spec's scope); confirm against the live viewer in Step 4.

- [ ] **Step 4: Run to verify PASS** — `pnpm test:e2e tests/e2e/generate-flow.spec.ts` — Expected: PASS. (If `canvas` never mounts because the mock `mesh_url` 404s, drop the canvas assertion — keep the label assertion — and note it in the commit body.)

- [ ] **Step 5: Commit** — `git add tests/e2e/generate-flow.spec.ts` then `git commit -m "test(e2e): align generate-flow mock with real /api/generate contract"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.5: Fix `slice-flow.spec.ts` generate mock (structural)

`(structural)` — same fixture-shape fix. The slice assertions themselves are already correct against `SliceButton.tsx` (`'Slice for printing'` line 106; `'42 min'`/`'7.3 g'` lines 128/134; `'Download .3mf'` line 141; and the `/api/slice` mock shape `{ url, inline_base64, meta:{ print_time_min, filament_g } }` matches). The spec only rots because its **generate** mock (`slice-flow.spec.ts:11-18`) is the legacy `jscad_code` shape with no `meta`, so the assistant bubble path throws before the user can click Slice.

**Files:**
- Modify: `tests/e2e/slice-flow.spec.ts:8-18`

- [ ] **Step 1: This is the test** — fix only the `/api/generate` mock; leave the `/api/slice` mock (lines 21-31) and all slice assertions (lines 43-48) untouched.

- [ ] **Step 2: Run to verify current FAIL** — `pnpm test:e2e tests/e2e/slice-flow.spec.ts` — Expected: FAIL — canvas/Slice button never reached because the generate response has no `meta`.

- [ ] **Step 3: Implement** — replace the generate `route.fulfill` body (lines 12-18). Keep `FIXTURE_CODE` removed (unused after this change):
```ts
test('user generates a disc, slices it, sees stats and a download button', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000099',
        mesh_url: '/meshes/00000000-0000-0000-0000-000000000099.stl',
        mesh_base64: null,
        design: { kind: 'disc', diameterMm: 40, thicknessMm: 3 },
        design_adjustments: [],
        warnings: [],
        meta: { kind: 'disc', bbox_mm: { x: 40, y: 40, z: 3 } },
      }),
    })
  })
  // ... /api/slice mock (lines 21-31) unchanged ...
```
Also delete the now-unused `FIXTURE_CODE` const (lines 4-5) and adjust the prompt text to `'a 40mm disc'` to stay consistent. Leave the Slice/stats/download assertions exactly as-is — they already match `SliceButton.tsx`.

- [ ] **Step 4: Run to verify PASS** — `pnpm test:e2e tests/e2e/slice-flow.spec.ts` — Expected: PASS (`42 min`, `7.3 g`, `Download .3mf` all visible). If `canvas` mount blocks on the 404 mesh, gate Slice on the chat label instead of the canvas (same caveat as 2.4).

- [ ] **Step 5: Commit** — `git add tests/e2e/slice-flow.spec.ts` then `git commit -m "test(e2e): align slice-flow generate mock with real contract"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.6: Fix `image-trophy-flow.spec.ts` stale copy assertions (structural)

`(structural)` — fixture + assertion fix. The generate mock here (`image-trophy-flow.spec.ts:30-42`) is *already* the generative shape with `meta`, so the throw is avoided — but two assertions are stale: line 69 asserts `chat-history` contains `/trophy base/i`, and line 39's `meta.base_mode='with_base'` is **not** part of the real contract (`route.ts:363-366` `meta` only has `kind` + `bbox_mm`). The UI renders `resultLabel(meta)` (no "trophy base" string exists anywhere in `Chat.tsx`) and the `meshy` badge comes from `strategy==='generative'` at `Chat.tsx:213`. The `meshy` badge assertion (line 73) and canvas assertion (line 75) are correct.

**Files:**
- Modify: `tests/e2e/image-trophy-flow.spec.ts:30-75`

- [ ] **Step 1: This is the test** — drop the non-existent `base_mode` from the mock `meta`, replace the `/trophy base/i` assertion with one that matches what `Chat` actually renders for a `meta`-less-`kind` generative result (`resultLabel` returns `'Generated'` when `kind` is absent), keep the `meshy` badge + canvas assertions.

- [ ] **Step 2: Run to verify current FAIL** — `pnpm test:e2e tests/e2e/image-trophy-flow.spec.ts` — Expected: FAIL at line 69 — `chat-history` never contains "trophy base".

- [ ] **Step 3: Implement** — update the mock `meta` (line 39) and the assertion (lines 68-73). The generative path returns no `kind` for a Meshy/freeform mesh, so `resultLabel` yields `"Generated"`:
```ts
  // Mock /api/generate — generative (Meshy) response. Real contract: meta = { kind?, bbox_mm? }.
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: 'generative',
        iteration_id: '00000000-0000-0000-0000-000000000077',
        mesh_url: null,
        mesh_base64: makeOneTriangleSTL().toString('base64'),
        design: { kind: 'freeform', prompt: 'troféu', sourceImageUrl: '/uploads/mock-logo.png' },
        design_adjustments: [],
        warnings: [],
        meta: {},
      }),
    })
  })
```
And the assertions block (replacing lines 68-75):
```ts
  // Generative result with no parametric kind → resultLabel(meta) renders "Generated".
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/generated/i, {
    timeout: 10_000,
  })
  // Strategy badge "meshy" (Chat.tsx:213, strategy === 'generative').
  await expect(page.locator('[data-testid="chat-history"]')).toContainText(/meshy/i)
  // Canvas renders the mesh (mesh_base64 STL).
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
```
(The upload mock at lines 17-27 and the `attached preview` wait at line 62 are correct — leave them.)

- [ ] **Step 4: Run to verify PASS** — `pnpm test:e2e tests/e2e/image-trophy-flow.spec.ts` — Expected: PASS (label, `meshy` badge, canvas all present). The mesh here comes from inline `mesh_base64`, so the canvas should mount without any network fetch.

- [ ] **Step 5: Commit** — `git add tests/e2e/image-trophy-flow.spec.ts` then `git commit -m "test(e2e): drop non-existent base_mode + stale 'trophy base' copy assertion"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.7: Verify all 5 E2E specs pass against `:3001`

Confirms the spec acceptance ("`pnpm test:e2e` 5/5 green against `:3001`") before CI is added. `homepage.spec.ts` and the already-generative `generative-flow.spec.ts` need no edits — re-run the whole suite.

**Files:** (none — verification only)

- [ ] **Step 1: Verification run** — with Docker Postgres up and the app reachable on `:3001`:
```bash
E2E_BASE_URL=http://localhost:3001 E2E_TEST_EMAIL=gustavo.b.paris@gmail.com pnpm test:e2e
```
Expected: `5 passed` — `homepage`, `generate-flow`, `generative-flow`, `slice-flow`, `image-trophy-flow`. (`reuseExistingServer` reuses a running `pnpm dev --port 3001`; otherwise Playwright starts one per the webServer config.)

- [ ] **Step 2: If any spec is red** — re-open that spec against the live UID strings in `Chat.tsx`/`SliceButton.tsx`; adjust only the assertion (never weaken to a tautology). Re-run until 5/5.

- [ ] **Step 3: Commit** — no code change; if a spec needed a touch-up, fold it into that spec's commit (2.4-2.6). Otherwise skip — nothing to commit.

---

### Task 2.8: Add the CI workflow (structural)

`(structural)` — introduces a repo-wide gate (`.github/workflows/ci.yml`) that every push/PR must pass. Node 22 + pnpm 9 per global conventions; `npx` for tsc/eslint (never bare). Unit/lint/tsc run unconditionally; E2E runs in a job with a Postgres service container (the `test-login` route at `src/app/api/auth/test-login/route.ts:30-39` inserts `users`/`sessions`, so E2E needs a real DB) against a built app (`next build && next start --port 3001` with `E2E_BASE_URL`).

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: No unit test** — workflow YAML; validated by the verification in Step 2 and the first green run in Step 4.

- [ ] **Step 2: Verification (lint the YAML + dry-confirm tools)** — locally confirm the gate commands the workflow runs all pass before pushing:
```bash
pnpm install --frozen-lockfile && pnpm lint && npx tsc --noEmit && pnpm test
```
Expected: lint 0/0, tsc 0 errors, vitest all pass (per the spec baseline: 175 pass / 1 skip).

- [ ] **Step 3: Implement** — write the workflow. The E2E job builds, boots `next start` on `:3001` in the background, waits for it, then runs Playwright with `E2E_BASE_URL`:
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    name: lint · types · unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: npx tsc --noEmit
      - run: pnpm test

  e2e:
    name: e2e (built app)
    runs-on: ubuntu-latest
    needs: quality
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/app
      E2E_ALLOW_TEST_LOGIN: '1'
      E2E_BASE_URL: http://localhost:3001
      E2E_TEST_EMAIL: gustavo.b.paris@gmail.com
      AUTH_SECRET: ci-e2e-secret-not-used-in-prod
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - name: Start app
        run: pnpm start --port 3001 &
      - name: Wait for app
        run: npx wait-on http://localhost:3001 --timeout 60000
      - run: pnpm test:e2e
```
Notes grounded in the repo: the env var is `AUTH_ALLOWED_EMAILS` (`src/env.ts:8`; `allowedEmails` is the derived Set used by `test-login` at line 25) — there is no `ALLOWED_EMAILS`. Add `AUTH_ALLOWED_EMAILS: gustavo.b.paris@gmail.com` (the e2e login email) to the `e2e` job `env`, plus the other required keys `src/env.ts` validates at boot (`AUTH_SECRET`, `DATABASE_URL`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `E2E_ALLOW_TEST_LOGIN=1`); without `AUTH_ALLOWED_EMAILS` the e2e job fails env validation. `wait-on` is invoked via `npx` (no new devDep). `pnpm start` is `next start` (package.json:8); passing `--port 3001` matches `E2E_BASE_URL`. Since `playwright.config.ts` `reuseExistingServer` is false under `CI`, Playwright will NOT spawn its own dev server — it uses the already-started `next start`. To avoid Playwright trying to start `pnpm dev` in CI, the implementer should confirm the webServer block is skipped when `E2E_BASE_URL` is external; if not, gate `webServer` behind `!process.env.E2E_BASE_URL` in `playwright.config.ts` (a 1-line follow-up to 2.3).

- [ ] **Step 4: Verify the workflow statically — DO NOT push mid-arc** (the push is GATE 2, owned by `/finishing-a-development-branch` in Phase 9). Lint the YAML and confirm it parses + the job/step graph is well-formed:
```bash
npx --yes actionlint .github/workflows/ci.yml
```
Expected: actionlint exits 0 (no syntax/expression errors). Also sanity-check the steps locally without GitHub — the same commands run green in Phase 9's gate (`pnpm lint`, `npx tsc --noEmit`, `pnpm test --coverage`, and `E2E_BASE_URL=… pnpm test:e2e` against a built app). The **live** CI run is observed only AFTER the operator pushes at GATE 2 — at that point `gh run watch --exit-status` should show `quality` + `e2e` concluding `success`. Note this as a post-GATE-2 confirmation in the final report; do not push here.

- [ ] **Step 5: Commit** — `git add .github/workflows/ci.yml` then `git commit -m "ci: add lint/types/unit + e2e (built app) GitHub Actions workflow"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.9: Add coverage provider + thresholds for mesh/flexify/3mf (structural)

`(structural)` — adds a devDependency (`@vitest/coverage-v8`, modifying `package.json` + `pnpm-lock.yaml`) and a `coverage` block to `vitest.config.ts` with per-directory thresholds. Current `vitest.config.ts` (16 lines) has no `coverage` key. Target dirs hold real logic with existing tests: `src/lib/mesh` (1 file, `tests/unit/mesh/*`), `src/lib/flexify` (8 files, `tests/unit/flexify/*`), `src/lib/3mf` (2 files, `tests/unit/3mf.test.ts`).

**Files:**
- Modify: `package.json:39-56` (devDependencies), `vitest.config.ts:5-16`

- [ ] **Step 1: Install the provider** — `pnpm add -D @vitest/coverage-v8` (must match the installed `vitest@^4.1.6` major). This writes `package.json` + `pnpm-lock.yaml`.

- [ ] **Step 2: Establish the baseline** — measure current coverage on the three dirs to set honest (non-failing) thresholds:
```bash
pnpm exec vitest run --coverage \
  --coverage.provider=v8 \
  --coverage.include='src/lib/mesh/**' \
  --coverage.include='src/lib/flexify/**' \
  --coverage.include='src/lib/3mf/**' \
  --coverage.reporter=text-summary
```
Expected: prints a `Lines/Statements/Branches/Functions %` summary. Record each number; set thresholds a few points below the measured floor so CI gates regressions without immediately failing.

- [ ] **Step 3: Implement** — add the `coverage` block to `vitest.config.ts` (currently the `test` object ends at line 12 with `setupFiles`). **The `lines/functions/branches/statements` numbers below are PLACEHOLDERS — do NOT commit them as-is. Replace each with the Step-2 measured floor minus ~3pts before committing** (Step 4 fails the task if the committed thresholds don't reflect the real baseline):
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
    setupFiles: ['tests/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      // Gate only the well-tested core libs (mesh/flexify/3mf); the rest of
      // src is exercised by integration/E2E and intentionally un-gated for now.
      include: [
        'src/lib/mesh/**',
        'src/lib/flexify/**',
        'src/lib/3mf/**',
      ],
      thresholds: {
        // PLACEHOLDERS — overwrite with the Step-2 measured floor minus ~3pts.
        // Committing these literal values is a task failure (see Step 4).
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

- [ ] **Step 4: Verify the gate enforces (and that the placeholders are gone)** — confirm the committed thresholds equal the Step-2 baseline (NOT the literal 70/70/60/70 placeholders), then `pnpm test --coverage` — Expected: PASS with the summary printed, AND temporarily bumping any threshold above the measured value makes the run FAIL with "ERROR: Coverage for lines (…%) does not meet threshold (…%)". Revert the temporary bump after confirming.

- [ ] **Step 5: Commit** — `git add package.json pnpm-lock.yaml vitest.config.ts` then `git commit -m "test(coverage): add v8 provider + thresholds for mesh/flexify/3mf"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 2.10: Wire coverage into CI

Makes the coverage gate (2.9) enforced on every push, completing the spec acceptance ("`pnpm test --coverage` enforces the threshold").

**Files:**
- Modify: `.github/workflows/ci.yml` (the `quality` job, the `pnpm test` step)

- [ ] **Step 1: No unit test** — workflow edit; verified by the next CI run.

- [ ] **Step 2: Implement** — in the `quality` job, replace the `- run: pnpm test` step with the coverage-enforcing form:
```yaml
      - run: pnpm test --coverage
```
(Thresholds in `vitest.config.ts` make this fail the job on regression; no extra flags needed.)

- [ ] **Step 3: Verify statically — DO NOT push mid-arc** — `npx --yes actionlint .github/workflows/ci.yml` (Expected: exits 0) and confirm `pnpm test --coverage` passes locally (the exact command the job runs). The live `quality`-job-green confirmation happens after the operator's GATE-2 push (Phase 9), via `gh run watch --exit-status`; record it in the final report. Do not push here.

- [ ] **Step 4: Commit** — `git add .github/workflows/ci.yml` then `git commit -m "ci: enforce coverage thresholds in the quality job"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

**Phase 2 grounding notes for the executor:**
- The spec's "guard `Chat.tsx:156` `body.meta?.bbox_mm`" is real but the line was *partially* already safe — `Chat.tsx:153` already typed `bbox_mm?` optional and line 157 guarded `bb ? …`. The actual crash is `body.meta` itself being `undefined` (legacy mock had no `meta`). Tasks 2.1-2.2 fix it at the `body.meta?` level via the extracted `resultLabel` helper.
- No jsdom/`@testing-library` is installed and all vitest tests run `environment: 'node'`; that's why the Chat guard is unit-tested through the extracted pure helper rather than a render test.
- `slice-flow.spec.ts` slice assertions (`'Slice for printing'`, `'42 min'`, `'7.3 g'`, `'Download .3mf'`) already match `src/components/SliceButton.tsx:106,128,134,141` — only its **generate** mock rots it.
- `image-trophy-flow.spec.ts` already used the generative shape; its rot is the stale `/trophy base/i` copy assertion + a `meta.base_mode` field that does not exist in the real contract (`route.ts:363-366`).
- `generative-flow.spec.ts` and `homepage.spec.ts` need no changes.

---

I have all the grounding I need. Producing the Phase 3 plan.

## Phase 3 — Core-loop correctness & trust

**Goal:** Make the generate→view→slice loop tell the truth — real slice metadata, honest watertight reporting, correct status/badges, visible auth failures, no LLM-prompt bloat, no stuck rows, and resilient LLM calls.

---

### Task 3.1: Add a 3MF metadata parser to the slicer service [structural]

The slicer regex (`slicer/src/server.ts:93-94`) matches `print`/`estimated printing` against OrcaSlicer's `--debug 5` STDOUT, but the real numbers live in the output 3MF, not stdout (`timeMatch`/`weightMatch` are always null → UI shows "—"). Parse `Metadata/slice_info.config` (`<metadata key="prediction" value="<seconds>"/>` and `<filament ... used_g="..." used_m="..."/>`) with `Metadata/plate_1.gcode` headers as fallback. The slicer service has only `express`; add `fflate` (already a root dep) for the unzip.

**Files:**
- Create: `slicer/src/slice-meta.ts`
- Modify: `slicer/package.json` (add `fflate` dependency)
- Test: `tests/unit/slicer/slice-meta.test.ts`

- [ ] **Step 1: Write the failing test.** The parser is pure (Buffer of a .3mf zip → `{ print_time_min, filament_g, filament_m }`). Build a tiny in-memory zip with `fflate` containing a realistic `Metadata/slice_info.config`. Note: the slicer service is ESM (`"type":"module"`) and not in the vitest `include` glob, so import the helper into the test via a relative path from the repo and add it to coverage by living in `tests/unit/slicer/`.

```ts
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parse3mfSliceMeta } from '../../../slicer/src/slice-meta'

function make3mf(sliceInfo: string, gcode?: string): Buffer {
  const files: Record<string, Uint8Array> = {
    'Metadata/slice_info.config': strToU8(sliceInfo),
  }
  if (gcode) files['Metadata/plate_1.gcode'] = strToU8(gcode)
  return Buffer.from(zipSync(files))
}

describe('parse3mfSliceMeta', () => {
  it('reads prediction seconds + filament grams/metres from slice_info.config', () => {
    const buf = make3mf(
      `<?xml version="1.0"?>
<config>
 <plate>
  <metadata key="index" value="1"/>
  <metadata key="prediction" value="5400"/>
  <filament id="1" tray_info_idx="GFL99" type="PLA" used_m="3.21" used_g="9.7"/>
 </plate>
</config>`,
    )
    const meta = parse3mfSliceMeta(buf)
    expect(meta.print_time_min).toBeCloseTo(90, 5) // 5400s → 90min
    expect(meta.filament_g).toBeCloseTo(9.7, 5)
    expect(meta.filament_m).toBeCloseTo(3.21, 5)
  })

  it('falls back to gcode headers when slice_info has no prediction', () => {
    const buf = make3mf(
      `<config><plate></plate></config>`,
      `; total estimated time: 1h 2m 30s\n; filament used [g] : 12.40\n; filament used [mm] : 4100.0\n`,
    )
    const meta = parse3mfSliceMeta(buf)
    expect(meta.print_time_min).toBeCloseTo(62.5, 1) // 1h2m30s
    expect(meta.filament_g).toBeCloseTo(12.4, 5)
    expect(meta.filament_m).toBeCloseTo(4.1, 3) // 4100mm → 4.1m
  })

  it('returns nulls (never throws) when the zip lacks both sources', () => {
    const meta = parse3mfSliceMeta(Buffer.from(zipSync({ 'foo.txt': strToU8('x') })))
    expect(meta).toEqual({ print_time_min: null, filament_g: null, filament_m: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/slicer/slice-meta.test.ts` — Expected: FAIL (`Cannot find module '../../../slicer/src/slice-meta'`).
- [ ] **Step 3: Implement** `slicer/src/slice-meta.ts`. Sum `used_g`/`used_m` across all `<filament>` entries; parse `prediction` (seconds) → minutes; gcode time supports both `1h 2m 30s` and a bare seconds value; gcode mm → m. All extraction wrapped so a malformed zip returns nulls.

```ts
import { unzipSync, strFromU8 } from 'fflate'

export type SliceMeta = {
  print_time_min: number | null
  filament_g: number | null
  filament_m: number | null
}

const EMPTY: SliceMeta = { print_time_min: null, filament_g: null, filament_m: null }

/** OrcaSlicer writes the real estimates into the output 3MF, not stdout. Read
 *  Metadata/slice_info.config first (authoritative), then fall back to the
 *  plate_1.gcode header comments. Never throws — returns nulls on any failure. */
export function parse3mfSliceMeta(zip: Buffer): SliceMeta {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(zip))
  } catch {
    return { ...EMPTY }
  }

  const out: SliceMeta = { ...EMPTY }
  const cfgKey = Object.keys(files).find((k) => k.endsWith('slice_info.config'))
  if (cfgKey) {
    const xml = strFromU8(files[cfgKey])
    const pred = xml.match(/key="prediction"\s+value="([0-9.]+)"/i)
    if (pred) out.print_time_min = Number(pred[1]) / 60
    let g = 0, m = 0, sawG = false, sawM = false
    for (const f of xml.matchAll(/<filament\b[^>]*\/?>/gi)) {
      const tag = f[0]
      const ug = tag.match(/used_g="([0-9.]+)"/i)
      const um = tag.match(/used_m="([0-9.]+)"/i)
      if (ug) { g += Number(ug[1]); sawG = true }
      if (um) { m += Number(um[1]); sawM = true }
    }
    if (sawG) out.filament_g = g
    if (sawM) out.filament_m = m
  }

  const gKey = Object.keys(files).find((k) => /plate_\d+\.gcode$/i.test(k))
  if (gKey && (out.print_time_min == null || out.filament_g == null || out.filament_m == null)) {
    const head = strFromU8(files[gKey]).slice(0, 8000)
    if (out.print_time_min == null) {
      const t = head.match(/total estimated time:\s*([^\n;]+)/i)
      if (t) out.print_time_min = parseGcodeTimeMin(t[1].trim())
    }
    if (out.filament_g == null) {
      const fg = head.match(/filament used \[g\]\s*:\s*([0-9.]+)/i)
      if (fg) out.filament_g = Number(fg[1])
    }
    if (out.filament_m == null) {
      const fm = head.match(/filament used \[mm\]\s*:\s*([0-9.]+)/i)
      if (fm) out.filament_m = Number(fm[1]) / 1000
    }
  }
  return out
}

function parseGcodeTimeMin(s: string): number | null {
  const hms = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const h = Number(hms[1] ?? 0), m = Number(hms[2] ?? 0), sec = Number(hms[3] ?? 0)
    return h * 60 + m + sec / 60
  }
  const bare = Number(s)
  return Number.isFinite(bare) ? bare / 60 : null
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/slicer/slice-meta.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add slicer/src/slice-meta.ts slicer/package.json tests/unit/slicer/slice-meta.test.ts` then `git commit -m "feat(slicer): parse real slice metadata from output 3MF"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 3.2: Wire the 3MF metadata parser into the slice endpoint [structural]

`slicer/src/server.ts:91-103` reads `out.3mf` into `out`, then uses the dead stdout regex for `meta`. Read `out` (the 3MF Buffer) through `parse3mfSliceMeta` and return real values. Response shape gains `filament_m` (additive). **Task 3.3 widens `src/lib/slicer/client.ts`'s `SliceResult.meta` to carry `filament_m` and surfaces it in the UI — otherwise the client's typed `json.meta` passthrough silently drops the new field at the type boundary.**

**Files:**
- Modify: `slicer/src/server.ts:91-103`

- [ ] **Step 1 (verification, no unit test — server boots OrcaSlicer):** confirm the import + shape compile under the slicer's own tsconfig.
- [ ] **Step 2: Implement.** Add `import { parse3mfSliceMeta } from './slice-meta'` near the top, then replace the stdout-regex block:

```ts
    const out = readFileSync(outPath)
    const meta = parse3mfSliceMeta(out)

    res.json({
      bytes_base64: out.toString('base64'),
      meta: {
        print_time_min: meta.print_time_min,
        filament_g: meta.filament_g,
        filament_m: meta.filament_m,
        stdout_tail: result.stdout.slice(-1000),
      },
    })
```

(Delete the now-unused `timeMatch`/`weightMatch` lines and the `const stdout = result.stdout` alias — reference `result.stdout` directly.)

- [ ] **Step 3: Verify type-check** — `cd slicer && npx tsc --noEmit -p tsconfig.json` — Expected: no errors. (Run from repo root as `npx --prefix slicer tsc ...` is unreliable; use a compound `bash -c 'cd slicer && npx tsc --noEmit'`.)
- [ ] **Step 4: DEPLOY NOTE (flag for executor).** `slicer/` is a separate Railway service. This change is inert until that service is redeployed (`railway up` in `slicer/`, or push to the Railway-tracked branch). The Next-side UI fix (3.3) ships independently and will show real numbers only after the slicer redeploy.
- [ ] **Step 5: Commit** — `git add slicer/src/server.ts` then `git commit -m "feat(slicer): return real print-time/filament from 3MF metadata"` (trailer).

---

### Task 3.3: Harden + widen SliceButton metadata display (real `0`, filament length) [structural]

`SliceButton.tsx:128` and `:134` use truthy checks (`result.meta.print_time_min ? ...`), so a legitimate `0` renders as "—". Switch to `!= null`. Also widen `src/lib/slicer/client.ts`'s `SliceResult.meta` to carry the new `filament_m` (from Task 3.2) — its current type omits it, so the typed `json.meta` passthrough drops it — and surface filament length (meters) alongside grams, which is the more useful number for a 3D-print user. (structural: the `SliceResult.meta` type is a shared contract.)

**Files:**
- Modify: `src/lib/slicer/client.ts` (`SliceResult.meta` type — add `filament_m: number | null`)
- Modify: `src/components/SliceButton.tsx:128,134` (+ a meters line)
- Test: `tests/unit/slicer/slice-button-meta.test.ts`

- [ ] **Step 1: Write the failing test** — pure formatters are cleanest. Extract three tiny exported helpers from the component and test them (avoids R3F/DOM rendering).

```ts
import { describe, it, expect } from 'vitest'
import { fmtPrintTime, fmtFilament, fmtFilamentM } from '@/components/SliceButton'

describe('SliceButton metadata formatting', () => {
  it('renders a real 0 instead of em-dash', () => {
    expect(fmtPrintTime(0)).toBe('0 min')
    expect(fmtFilament(0)).toBe('0.0 g')
    expect(fmtFilamentM(0)).toBe('0.00 m')
  })
  it('renders em-dash only for null', () => {
    expect(fmtPrintTime(null)).toBe('—')
    expect(fmtFilament(null)).toBe('—')
    expect(fmtFilamentM(null)).toBe('—')
  })
  it('formats normal values', () => {
    expect(fmtPrintTime(90)).toBe('90 min')
    expect(fmtFilament(9.73)).toBe('9.7 g')
    expect(fmtFilamentM(2.694)).toBe('2.69 m')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/slicer/slice-button-meta.test.ts` — Expected: FAIL (`fmtPrintTime`/`fmtFilamentM` not exported).
- [ ] **Step 3: Implement** —
  - In `src/lib/slicer/client.ts`, add `filament_m` to the `SliceResult.meta` type (find the `meta:` shape with `print_time_min`/`filament_g` and add `filament_m: number | null`); the existing `meta: json.meta` passthrough then carries it.
  - Add the exported helpers at the top of `SliceButton.tsx` and use them at lines 128/134, plus a meters line:

```ts
export function fmtPrintTime(v: number | null): string {
  return v != null ? `${v.toFixed(0)} min` : '—'
}
export function fmtFilament(v: number | null): string {
  return v != null ? `${v.toFixed(1)} g` : '—'
}
export function fmtFilamentM(v: number | null): string {
  return v != null ? `${v.toFixed(2)} m` : '—'
}
```

Then replace the two inline expressions and add a filament-length line next to grams (PT-BR labels per the Phase 8 locale sweep):
```tsx
            <strong>{fmtPrintTime(result.meta.print_time_min)}</strong>
```
```tsx
            <strong>{fmtFilament(result.meta.filament_g)} · {fmtFilamentM(result.meta.filament_m)}</strong>
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/slicer/slice-button-meta.test.ts` — Expected: PASS; `pnpm exec tsc --noEmit` 0 (confirms the widened `SliceResult.meta` type lines up with the slicer response).
- [ ] **Step 5: Commit** — `git add src/lib/slicer/client.ts src/components/SliceButton.tsx tests/unit/slicer/slice-button-meta.test.ts` then `git commit -m "fix(slice-ui): real 0 + filament length; carry filament_m through client meta"` (trailer).

---

### Task 3.4: Fix the parametric `flat_plate` builder to emit watertight geometry

**Reproduced:** an 80×40×4 plate with no hole welds clean (`boundaryEdges: 0`), but adding a `hangingHole` yields **exactly 88 boundary edges** at every weld tolerance from 1e-4 up to 1e-2 mm (worse, not better, at coarser tolerances — proving these are genuine torn edges spanning the whole plate, not numerical noise the analyzer mis-grids). Root cause: JSCAD's `booleans.subtract` re-tessellates `roundedCuboid` and leaves cracks. The analyzer is correct; the geometry is the bug. The repo already welds soups via three's `mergeVertices` inside `src/lib/import/manifold-csg.ts:43-57` (`soupToIndexed`) — reuse that exact technique to weld each body's final positions before returning, which closes the cracks.

**Files:**
- Modify: `src/lib/design/generate.ts` (add a `weldSoup` helper + apply it in `geom3ToPositions`)
- Test: `tests/unit/design-watertight.test.ts`

- [ ] **Step 1: Write the failing test** — assert the subtracted plate body is watertight:

```ts
import { describe, it, expect } from 'vitest'
import { generateFromDesign } from '@/lib/design/generate'
import { analyzeMeshValidity } from '@/lib/mesh/validity'
import { Design } from '@/lib/design/schema'

describe('parametric builders emit watertight geometry', () => {
  it('flat_plate with a hanging hole has zero boundary edges', async () => {
    const design = Design.parse({
      kind: 'flat_plate',
      widthMm: 80, heightMm: 40, thicknessMm: 4, cornerRadiusMm: 2,
      hangingHole: { diameterMm: 5, position: 'top' },
    })
    const r = await generateFromDesign(design, { logoImageBuffer: null })
    const report = analyzeMeshValidity(r.bodies[0].positions)
    expect(report.boundaryEdges).toBe(0)
    expect(report.nonManifoldEdges).toBe(0)
    expect(report.watertight).toBe(true)
  })

  it('plain flat_plate (no hole) stays watertight', async () => {
    const design = Design.parse({
      kind: 'flat_plate', widthMm: 80, heightMm: 40, thicknessMm: 4, cornerRadiusMm: 2,
    })
    const r = await generateFromDesign(design, { logoImageBuffer: null })
    expect(analyzeMeshValidity(r.bodies[0].positions).watertight).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/design-watertight.test.ts` — Expected: FAIL (`boundaryEdges` is 88, `watertight` is false).
- [ ] **Step 3: Implement** — add a `weldSoup` helper mirroring `soupToIndexed` (three's `mergeVertices`), and route `geom3ToPositions` (currently `generate.ts:1027-1039`) through it so every JSCAD body is welded into a closed surface before it leaves the builder:

```ts
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Weld a triangle soup so the booleans.subtract cut-ring vertices coincide.
 *  JSCAD's BSP subtract re-tessellates and leaves coincident-but-distinct
 *  vertices that read as boundary edges (an 80×40×4 plate + hole → 88 of them).
 *  three's mergeVertices collapses them, restoring a closed surface — the same
 *  repair manifold-csg.ts already relies on. */
function weldSoup(positions: Float32Array, tol = 1e-4): Float32Array {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
  const merged = mergeVertices(geo, tol)
  const pos = merged.getAttribute('position')
  const idx = merged.getIndex()
  if (!idx) return positions
  const out = new Float32Array(idx.count * 3)
  for (let i = 0; i < idx.count; i++) {
    const v = idx.getX(i)
    out[i * 3] = pos.getX(v)
    out[i * 3 + 1] = pos.getY(v)
    out[i * 3 + 2] = pos.getZ(v)
  }
  return out
}

function geom3ToPositions(g: Geom3): Float32Array {
  const polys = geometries.geom3.toPolygons(g)
  const out: number[] = []
  for (const poly of polys) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        out.push(v[0], v[1], v[2])
      }
    }
  }
  return weldSoup(new Float32Array(out))
}
```

(Note for executor: the existing `design-generate.test.ts` asserts `triangleCount` strictly greater after a subtract and exact logo bbox X values — welding does not change triangle *count* or vertex *positions*, only their identity, so those assertions still hold. Re-run the full generate suite in step 4.)

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/design-watertight.test.ts tests/unit/design-generate.test.ts` — Expected: PASS (both files).
- [ ] **Step 5: Commit** — `git add src/lib/design/generate.ts tests/unit/design-watertight.test.ts` then `git commit -m "fix(generate): weld parametric body soups so subtracts stay watertight"` (trailer).

---

### Task 3.5: Gate the "Logo aqui" control on an imported base mesh

`ProjectWorkspace.tsx:316-328` shows the "📍 Logo aqui" button whenever `positions` is truthy. On a parametric design `applyLogoPlacement` (`:240-254`) POSTs `logoPlacement`, but `/api/generate:226-234` rejects it with 400 ("No imported mesh to place the logo on.") and writes a `failed` iteration. The placement only makes sense when an imported mesh exists. `pendingMeshUrl` tracks a fresh `.3mf` upload; a cached imported design is detectable from history via `validationReport.kind === 'imported'` (the same probe `/api/generate:158-161` uses). Gate the button on either.

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx` (~39-46 derive flag; ~316 gate)
- Test: `tests/unit/project-workspace-logo-gate.test.ts`

- [ ] **Step 1: Write the failing test** — extract a pure predicate and test it (avoids rendering the R3F workspace):

```ts
import { describe, it, expect } from 'vitest'
import { hasImportedBase } from '@/components/ProjectWorkspace'

const it_ = (over: Record<string, unknown>) =>
  ({ validationReport: null, ...over }) as never

describe('hasImportedBase', () => {
  it('true when a fresh .3mf is pending', () => {
    expect(hasImportedBase([], 'blob://mesh.3mf')).toBe(true)
  })
  it('true when history has an imported design', () => {
    const history = [it_({ validationReport: { kind: 'imported', baseMeshUrl: '/x.3mf' } })]
    expect(hasImportedBase(history, null)).toBe(true)
  })
  it('false for a purely parametric project', () => {
    const history = [it_({ validationReport: { kind: 'flat_plate', widthMm: 80 } })]
    expect(hasImportedBase(history, null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/project-workspace-logo-gate.test.ts` — Expected: FAIL (`hasImportedBase` not exported).
- [ ] **Step 3: Implement** — add the exported predicate near the top of `ProjectWorkspace.tsx`, derive it in the component, and gate the button:

```ts
export function hasImportedBase(
  history: Pick<Iteration, 'validationReport'>[],
  pendingMeshUrl: string | null,
): boolean {
  if (pendingMeshUrl) return true
  return history.some((it) => {
    const vr = it.validationReport as { kind?: string } | null
    return vr?.kind === 'imported'
  })
}
```

Inside the component (after `pendingMeshUrl` state, ~line 59):
```ts
  const importedBaseAvailable = hasImportedBase(initialHistory, pendingMeshUrl)
```

Change the button guard at `:316`:
```tsx
          {positions && importedBaseAvailable && (
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/project-workspace-logo-gate.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/components/ProjectWorkspace.tsx tests/unit/project-workspace-logo-gate.test.ts` then `git commit -m "fix(workspace): hide Logo-aqui unless an imported base mesh exists"` (trailer).

---

### Task 3.6: Enforce slice preconditions and slice the server-persisted mesh [structural]

`/api/slice/route.ts:14-33` accepts client `stlBase64` and (`:77-85`) sets `status='sliced'` from any state. Two domain holes: (1) it trusts whatever bytes the client sends rather than the persisted `meshBlobUrl`; (2) it will re-slice/transition a `generating` or `failed` row. Fix: require `status IN ('ready','sliced')` and fetch the persisted mesh server-side (the row already has `meshBlobUrl`). Drop `stlBase64` from the request body.

**Files:**
- Modify: `src/app/api/slice/route.ts:14-33` (body + precondition), `:35-55` (load persisted mesh instead of client bytes)
- Test: `tests/unit/slice-route-precondition.test.ts`

- [ ] **Step 1: Write the failing test** — the precondition gate is the testable unit. Extract a pure `assertSliceable(status)` helper returning a discriminated result, and test it (the route's auth/db/blob path is integration-only):

```ts
import { describe, it, expect } from 'vitest'
import { assertSliceable } from '@/app/api/slice/route'

describe('assertSliceable', () => {
  it('allows ready and sliced', () => {
    expect(assertSliceable('ready').ok).toBe(true)
    expect(assertSliceable('sliced').ok).toBe(true)
  })
  it('rejects generating and failed with a 409', () => {
    const g = assertSliceable('generating')
    expect(g.ok).toBe(false)
    expect(g.ok ? null : g.status).toBe(409)
    expect(assertSliceable('failed').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/slice-route-precondition.test.ts` — Expected: FAIL (`assertSliceable` not exported).
- [ ] **Step 3: Implement.** Export the helper, drop `stlBase64` from the `Body` schema (structural — client no longer sends bytes), gate on status, and load `row.iteration.meshBlobUrl` instead of decoding client base64.

```ts
const Body = z.object({
  iterationId: z.string().uuid(),
})

type Sliceable = { ok: true } | { ok: false; status: number; message: string }
export function assertSliceable(status: string): Sliceable {
  return status === 'ready' || status === 'sliced'
    ? { ok: true }
    : { ok: false, status: 409, message: `Cannot slice an iteration with status "${status}"` }
}
```

After the ownership-checked `row` lookup (`:33`):
```ts
  const gate = assertSliceable(row.iteration.status)
  if (!gate.ok) return new Response(gate.message, { status: gate.status })

  if (!row.iteration.meshBlobUrl) {
    return new Response('Iteration has no persisted mesh to slice', { status: 409 })
  }

  // Slice the SERVER-persisted mesh, not bytes the client sent. Blob URLs are
  // absolute (http); local-dev meshes are relative under public/.
  let meshBytes: Buffer
  try {
    const url = row.iteration.meshBlobUrl
    if (url.startsWith('http')) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch ${res.status}`)
      meshBytes = Buffer.from(await res.arrayBuffer())
    } else {
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      meshBytes = await readFile(join(process.cwd(), 'public', url))
    }
  } catch (e) {
    return new Response(`Failed to load persisted mesh: ${(e as Error).message}`, { status: 502 })
  }
```

Then keep the existing 3MF→STL flatten block (`:41-51`) operating on `meshBytes`. (Executor note: `SliceButton.tsx:45-63` currently encodes and POSTs `stlBase64` — that becomes dead and the body shrinks to `{ iterationId }`; update the `fetch` body there and drop the chunked base64 encode. Flag this as the (structural) client-contract change.)

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/slice-route-precondition.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/app/api/slice/route.ts src/components/SliceButton.tsx tests/unit/slice-route-precondition.test.ts` then `git commit -m "fix(slice): require ready/sliced status and slice the persisted mesh"` (trailer).

---

### Task 3.7: Branch chat history on iteration status (failed/generating ≠ "Generated")

`ProjectWorkspace.tsx:189-217` maps history on `strategy` only: a `failed` or `generating` row still renders an assistant bubble labelled `'Generated'` with no error. `Iteration` has `status` (`'generating'|'ready'|'failed'|'sliced'`) and `error` (`schema.ts:68-69`). Branch the mapping so failed rows surface `it.error` and in-flight rows show a spinner label.

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx:189-217` (and the `ChatMsg` type ~17-23 to carry `status`/`errorText`)
- Test: `tests/unit/project-workspace-history.test.ts`

- [ ] **Step 1: Write the failing test** — extract the mapping into a pure `mapHistoryToMessages(history)` and test it:

```ts
import { describe, it, expect } from 'vitest'
import { mapHistoryToMessages } from '@/components/ProjectWorkspace'

const row = (over: Record<string, unknown>) =>
  ({ id: 'i1', userMessage: 'faz um chaveiro', imageBlobUrl: null, jscadCode: null,
     validationReport: null, strategy: 'generative', status: 'ready', error: null, ...over }) as never

describe('mapHistoryToMessages', () => {
  it('renders a failed row as an error bubble, not "Generated"', () => {
    const msgs = mapHistoryToMessages([row({ status: 'failed', error: 'design parse failed: boom' })])
    const assistant = msgs.find((m) => m.role === 'assistant')!
    expect(assistant.status).toBe('failed')
    expect(assistant.text).not.toBe('Generated')
    expect(assistant.text).toContain('boom')
  })
  it('renders an in-flight row as generating', () => {
    const msgs = mapHistoryToMessages([row({ status: 'generating', error: null })])
    expect(msgs.find((m) => m.role === 'assistant')!.status).toBe('generating')
  })
  it('renders a ready generative row normally', () => {
    const msgs = mapHistoryToMessages([row({ status: 'ready' })])
    expect(msgs.find((m) => m.role === 'assistant')!.status).toBe('ready')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/project-workspace-history.test.ts` — Expected: FAIL (`mapHistoryToMessages` not exported).
- [ ] **Step 3: Implement.** Add `status` and an optional error string to `ChatMsg` (`:17-23`), extract the `initialMessages` builder (`:189-219`) into the exported pure function, and branch on `status`:

```ts
export function mapHistoryToMessages(history: Iteration[]): ChatMsg[] {
  return history.flatMap((it) => {
    const userMsg: ChatMsg = {
      role: 'user', text: it.userMessage, imageUrl: it.imageBlobUrl ?? undefined,
    }
    if (it.status === 'failed') {
      return [userMsg, {
        role: 'assistant', text: `Falhou: ${it.error ?? 'erro desconhecido'}`,
        iterationId: it.id, status: 'failed',
      }]
    }
    if (it.status === 'generating') {
      return [userMsg, { role: 'assistant', text: 'Gerando…', iterationId: it.id, status: 'generating' }]
    }
    if (it.strategy === 'parametric' && it.jscadCode) {
      return [userMsg, { role: 'assistant', text: it.jscadCode, iterationId: it.id, strategy: 'parametric', status: it.status }]
    }
    if (it.strategy === 'generative') {
      const design = it.validationReport ?? undefined
      return [userMsg, { role: 'assistant', text: 'Pronto', iterationId: it.id, strategy: 'generative', status: it.status, design }]
    }
    return [userMsg]
  })
}
```

Then replace the inline `const initialMessages = ...` with `const initialMessages = mapHistoryToMessages(initialHistory)`. Add `status?: 'generating' | 'ready' | 'failed' | 'sliced'` to `ChatMsg`. (Keep `Chat.tsx`'s own `Msg` type in sync — see 3.8.)

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/project-workspace-history.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/components/ProjectWorkspace.tsx tests/unit/project-workspace-history.test.ts` then `git commit -m "fix(workspace): render failed/generating iterations honestly in history"` (trailer).

---

### Task 3.8: Derive the strategy badge from design kind, not the hardcoded strategy

`Chat.tsx:211-215` renders the badge from `m.strategy` (`generative` → "meshy"). But the parametric pipeline always persists `strategy: 'generative'` (`/api/generate/route.ts:109`) even for JSCAD-built primitives, so a parametric flat_plate shows a false **MESHY** badge. Derive it from the design kind (`'freeform'` → real Meshy; everything else → parametric/jscad).

**Files:**
- Modify: `src/components/Chat.tsx:211-215` (badge) + add a helper
- Test: `tests/unit/chat-badge.test.ts`

- [ ] **Step 1: Write the failing test** — extract a pure `badgeFor(design)`:

```ts
import { describe, it, expect } from 'vitest'
import { badgeFor } from '@/components/Chat'

describe('badgeFor', () => {
  it('shows MESHY only for freeform designs', () => {
    expect(badgeFor({ kind: 'freeform', prompt: 'a dragon' })).toBe('meshy')
  })
  it('shows JSCAD for parametric primitives even though strategy is generative', () => {
    expect(badgeFor({ kind: 'flat_plate', widthMm: 80, heightMm: 40 })).toBe('jscad')
    expect(badgeFor({ kind: 'imported', baseMeshUrl: '/x.3mf' })).toBe('jscad')
  })
  it('falls back to jscad when design is missing/unknown', () => {
    expect(badgeFor(undefined)).toBe('jscad')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/chat-badge.test.ts` — Expected: FAIL (`badgeFor` not exported).
- [ ] **Step 3: Implement** — add the helper and use it (the `Msg` type already carries `design?: unknown` at `Chat.tsx:39`):

```ts
export function badgeFor(design: unknown): 'meshy' | 'jscad' {
  const kind = (design as { kind?: string } | undefined)?.kind
  return kind === 'freeform' ? 'meshy' : 'jscad'
}
```

Replace the badge block (`:211-215`):
```tsx
            {m.role === 'assistant' && m.strategy && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-700 uppercase align-top">
                {badgeFor(m.design)}
              </span>
            )}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/chat-badge.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/components/Chat.tsx tests/unit/chat-badge.test.ts` then `git commit -m "fix(chat): derive strategy badge from design kind, not stored strategy"` (trailer).

---

### Task 3.9: Surface magic-link sign-in failures

`sign-in/page.tsx:6-10` runs `await signIn('resend', formData)` with no try/catch and ignores `?error=`. When Resend's key is invalid the action throws (or NextAuth redirects with `?error=`) and the user sees nothing. Catch `AuthError` and render `searchParams.error`. (Server-component page → verification is a build/probe, not a unit test.)

**Files:**
- Modify: `src/app/sign-in/page.tsx`

- [ ] **Step 1: Implement.** Read `searchParams` (Next 16 passes it as a Promise — confirm against `node_modules/next/dist/docs/` per AGENTS.md before finalizing), wrap the action, and render an error banner. Magic-link `signIn` redirects on success, which NextAuth surfaces as a thrown `redirect` — re-throw it so only real `AuthError`s are caught.

```tsx
import { signIn } from '@/auth'
import { AuthError } from 'next-auth'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        action={async (formData) => {
          'use server'
          try {
            await signIn('resend', { ...Object.fromEntries(formData), redirectTo: '/sign-in?sent=1' })
          } catch (e) {
            if (isRedirectError(e)) throw e
            if (e instanceof AuthError) {
              const { redirect } = await import('next/navigation')
              redirect('/sign-in?error=EnvioFalhou')
            }
            throw e
          }
        }}
        className="w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="text-sm text-gray-500">
          Enviamos um link mágico por e-mail. Só endereços autorizados conseguem entrar.
        </p>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            Não foi possível enviar o link. Verifique o e-mail e tente novamente.
          </div>
        )}
        {sent && (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Link enviado — confira sua caixa de entrada.
          </div>
        )}
        <input name="email" type="email" required placeholder="voce@exemplo.com"
          className="w-full border rounded px-3 py-2" />
        <button type="submit" className="w-full bg-black text-white rounded py-2">
          Enviar link mágico
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 2: Verify (prod-build smoke).** `pnpm build` then start and probe both states:
  - `curl -s 'http://localhost:3000/sign-in?error=EnvioFalhou' | grep -o 'Não foi possível enviar o link'` — Expected: the error copy appears.
  - `curl -s 'http://localhost:3000/sign-in?sent=1' | grep -o 'Link enviado'` — Expected: the sent copy appears.
  - Confirm the exact `isRedirectError` import path against the installed Next version (`grep -r isRedirectError node_modules/next/dist/client/components/redirect-error*`); if it moved, use the documented Next 16 export.
- [ ] **Step 3: Commit** — `git add src/app/sign-in/page.tsx` then `git commit -m "fix(auth): surface magic-link send failures on sign-in page (PT-BR)"` (trailer).

---

### Task 3.10: Strip `_`-prefixed cache keys before feeding `previousDesign` to the LLM

`/api/generate/route.ts:339-342` stores `_faces` and `_previews` inside `validationReport` for imported designs (4-angle PNG data URLs — rows up to ~806KB). On the next turn `:210-215` reads that whole jsonb back as `previousDesign`, and `parse-import.ts:60-61` / `parse.ts:60-62` `JSON.stringify(previousDesign, …)` it straight into the prompt — pasting base64 previews into the LLM context. Strip `_`-prefixed keys when building `previousDesign`.

**Files:**
- Modify: `src/app/api/generate/route.ts:210-215`
- Test: `tests/unit/strip-cache-keys.test.ts`

- [ ] **Step 1: Write the failing test** — extract an exported `stripCacheKeys`:

```ts
import { describe, it, expect } from 'vitest'
import { stripCacheKeys } from '@/app/api/generate/route'

describe('stripCacheKeys', () => {
  it('removes _-prefixed keys (faces, previews) but keeps the design', () => {
    const vr = {
      kind: 'imported', baseMeshUrl: '/x.3mf', edits: [],
      _faces: [{ id: 0 }], _previews: { iso: 'data:image/png;base64,AAAA' },
    }
    const out = stripCacheKeys(vr) as Record<string, unknown>
    expect(out).toEqual({ kind: 'imported', baseMeshUrl: '/x.3mf', edits: [] })
    expect('_faces' in out).toBe(false)
    expect('_previews' in out).toBe(false)
  })
  it('passes through null and non-objects unchanged', () => {
    expect(stripCacheKeys(null)).toBeNull()
    expect(stripCacheKeys('x')).toBe('x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/strip-cache-keys.test.ts` — Expected: FAIL (`stripCacheKeys` not exported).
- [ ] **Step 3: Implement** — add the helper and apply it at `:210-215`:

```ts
export function stripCacheKeys(vr: unknown): unknown {
  if (!vr || typeof vr !== 'object') return vr
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(vr as Record<string, unknown>)) {
    if (!k.startsWith('_')) out[k] = v
  }
  return out
}
```

```ts
  const lastReadyWithDesign = [...history]
    .reverse()
    .find((h) => h.status === 'ready' && h.validationReport)
  const previousDesign = stripCacheKeys(lastReadyWithDesign?.validationReport ?? null) as
    | Awaited<ReturnType<typeof parseDesign>>
    | null
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/strip-cache-keys.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/app/api/generate/route.ts tests/unit/strip-cache-keys.test.ts` then `git commit -m "fix(generate): strip cached _faces/_previews before prompting the LLM"` (trailer).

---

### Task 3.11: Add a stuck-`generating` reaper and run it on history load

There is no reaper today (confirmed: zero `reaper`/`sweep`/`interval` references in `src`). Rows can hang in `generating` forever — and most route throw-paths already write `failed`, but the **final tail** (`/api/generate/route.ts:344-353`, the post-`persistMesh` `db.update`s) is unguarded: if `persistMesh` (`:335`) or the final updates throw, the row stays `generating`. Add a pure-SQL reaper (`status='generating' AND created_at < now()-interval '15 min' → failed`) and call it once at the top of the generate route (cheap, runs on every generate). Keep it as a route-hit reaper (no cron infra needed); leave a comment that a cron entry can call the same function.

**Files:**
- Create: `src/lib/db/reap-stuck-iterations.ts`
- Modify: `src/app/api/generate/route.ts` (import + call after auth, ~line 67)
- Test: `tests/unit/reap-stuck-iterations.test.ts`

- [ ] **Step 1: Write the failing test** — the reaper takes a `db`-like updater so it's unit-testable without Postgres. Assert it builds the right predicate and writes `failed`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { reapStuckIterations } from '@/lib/db/reap-stuck-iterations'

describe('reapStuckIterations', () => {
  it('marks generating rows older than the cutoff as failed', async () => {
    const calls: unknown[] = []
    const fakeDb = {
      update: () => ({ set: (v: unknown) => { calls.push(v); return { where: async () => [{ id: 'a' }, { id: 'b' }] } } }),
    } as never
    const reaped = await reapStuckIterations(fakeDb, 15)
    expect(reaped).toBe(2)
    expect(calls[0]).toMatchObject({ status: 'failed' })
    expect((calls[0] as { error?: string }).error).toMatch(/stuck|timed out|15/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/reap-stuck-iterations.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the reaper using drizzle `and`/`eq`/`lt`/`sql`:

```ts
import { and, eq, lt, sql } from 'drizzle-orm'
import { iterations } from '@/db/schema'
import type { db as Db } from '@/db'

/** Sweep iterations stuck in 'generating' past `minutes` → 'failed'. Idempotent;
 *  safe to call on any route hit. A cron job can call the same function. */
export async function reapStuckIterations(db: typeof Db, minutes = 15): Promise<number> {
  const rows = await db
    .update(iterations)
    .set({ status: 'failed', error: `reaper: stuck in 'generating' > ${minutes} min` })
    .where(
      and(
        eq(iterations.status, 'generating'),
        lt(iterations.createdAt, sql`now() - (${minutes} || ' minutes')::interval`),
      ),
    )
    .returning({ id: iterations.id })
  return rows.length
}
```

In `route.ts`, after the auth guard (`:67`):
```ts
  // Best-effort reaper: clear iterations stuck in 'generating' (crashed route,
  // unguarded tail throw). Non-fatal — never block a new generate on it.
  try { await reapStuckIterations(db) } catch (e) { console.error('[generate] reaper failed:', e) }
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/reap-stuck-iterations.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/db/reap-stuck-iterations.ts src/app/api/generate/route.ts tests/unit/reap-stuck-iterations.test.ts` then `git commit -m "feat(generate): reap iterations stuck in generating on route hit"` (trailer).

---

### Task 3.12: Guard the generate-route tail so throw paths write `failed`

`route.ts:335` (`persistMesh`) and `:344-353` (final `db.update`s for `iterations` + `projects`) run after the last try/catch ends at `:288`. A throw there escapes as an unhandled 500 and leaves the row `generating` (the gap the 3.11 reaper exists to clean up, but the row should be marked immediately). Wrap the tail in a try/catch that writes `failed` and returns a 500 JSON, matching the other failure handlers in this route.

**Files:**
- Modify: `src/app/api/generate/route.ts:335-367`
- Test: covered by 3.11's reaper for the crash case; this task is a structural guard verified by type-check + the existing generate integration smoke.

- [ ] **Step 1: Implement.** Wrap from `persistMesh` through the final response:

```ts
  try {
    const meshUrl = await persistMesh(finalMeshBytes, session.user.id, projectId, iteration.id)

    const validationReport: Record<string, unknown> =
      design.kind === 'imported' && importContext
        ? { ...(design as object), _faces: importContext.faces, _previews: importContext.previewDataUrls }
        : (design as unknown as Record<string, unknown>)

    await db.update(iterations)
      .set({ status: 'ready', meshBlobUrl: meshUrl, validationReport })
      .where(eq(iterations.id, iteration.id))
    await db.update(projects)
      .set({ currentIterationId: iteration.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    return Response.json({
      strategy: 'generative',
      iteration_id: iteration.id,
      mesh_url: meshUrl,
      mesh_base64: null,
      design,
      design_adjustments: designAdjustments,
      warnings: editWarnings,
      meta: { kind: design.kind, bbox_mm: metaBbox },
    })
  } catch (err) {
    const e = err as Error
    console.error('[generate] persist/finalize failed:', e.stack ?? e.message)
    await db.update(iterations)
      .set({ status: 'failed', error: `persist failed: ${e.message}` })
      .where(eq(iterations.id, iteration.id))
    return Response.json({ error: e.message, iteration_id: iteration.id }, { status: 500 })
  }
```

- [ ] **Step 2: Verify type-check + suite** — `pnpm exec tsc --noEmit && pnpm test tests/unit/strip-cache-keys.test.ts tests/unit/reap-stuck-iterations.test.ts` — Expected: tsc clean, both PASS (no behavior change on the happy path).
- [ ] **Step 3: Commit** — `git add src/app/api/generate/route.ts` then `git commit -m "fix(generate): write failed on persist/finalize throw paths"` (trailer).

---

### Task 3.13: Add timeout + one repair re-ask to the design parser

`parse.ts:65-93` calls `generateText` with no `abortSignal`, and `:102-117` does a single-shot `JSON.parse` + `Design.safeParse` that throws on the first malformed/invalid response. Add `abortSignal: AbortSignal.timeout(60_000)` and, on a JSON-or-schema failure, one repair re-ask that feeds the bad output + the error back to the model.

**Files:**
- Modify: `src/lib/design/parse.ts:65,102-117`
- Test: `tests/unit/design-parse-repair.test.ts`

- [ ] **Step 1: Write the failing test** — mock `ai.generateText` to return invalid JSON first, then valid on the repair call; assert two calls and a parsed design:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/lib/llm/model', () => ({ getClassifierModel: () => ({}) , getModel: () => ({}) }))
vi.mock('@/lib/meshy/client', () => ({ isMeshyConfigured: () => false }))

import { parseDesign } from '@/lib/design/parse'

beforeEach(() => generateText.mockReset())

describe('parseDesign repair re-ask', () => {
  it('re-asks once when the first reply is invalid JSON, then succeeds', async () => {
    generateText
      .mockResolvedValueOnce({ text: 'not json at all' })
      .mockResolvedValueOnce({ text: '{"kind":"flat_plate","widthMm":80,"heightMm":40}' })
    const d = await parseDesign({ messages: ['placa 80x40'], imageDescription: null })
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(d.kind).toBe('flat_plate')
  })

  it('passes an abortSignal with a 60s timeout', async () => {
    generateText.mockResolvedValueOnce({ text: '{"kind":"disc","diameterMm":50}' })
    await parseDesign({ messages: ['disco 50'], imageDescription: null })
    expect(generateText.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('throws after the repair re-ask also fails', async () => {
    generateText.mockResolvedValue({ text: 'still garbage' })
    await expect(parseDesign({ messages: ['x'], imageDescription: null })).rejects.toThrow()
    expect(generateText).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/design-parse-repair.test.ts` — Expected: FAIL (only one call; no repair, no `abortSignal`).
- [ ] **Step 3: Implement.** Add `abortSignal` to the first call (`:65-93`) and refactor `:95-117` into a helper that the repair path reuses:

```ts
  const { text } = await generateText({
    model: getClassifierModel(),
    system: SYSTEM,
    prompt: /* unchanged prompt */,
    maxOutputTokens: 800,
    abortSignal: AbortSignal.timeout(60_000),
  })

  const first = tryParseDesign(text)
  if (first.ok) return first.design

  // One repair re-ask: hand the model its own bad output + the error and let
  // it correct itself before we give up.
  const { text: repaired } = await generateText({
    model: getClassifierModel(),
    system: SYSTEM,
    prompt:
      `Your previous reply was not a valid Design JSON.\n` +
      `ERROR: ${first.error}\n` +
      `YOUR PREVIOUS REPLY:\n${text.slice(0, 1000)}\n\n` +
      `Reply again with ONLY valid JSON matching the schema. No markdown, no prose.`,
    maxOutputTokens: 800,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const second = tryParseDesign(repaired)
  if (second.ok) return second.design
  throw new Error(second.error)
}

type ParseAttempt = { ok: true; design: Design } | { ok: false; error: string }
function tryParseDesign(text: string): ParseAttempt {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, error: `LLM did not return valid JSON: ${(err as Error).message}\nGot: ${text.slice(0, 200)}` }
  }
  const result = Design.safeParse(json)
  if (!result.success) {
    return { ok: false, error: `LLM JSON did not match Design schema: ${result.error.message}\nGot: ${JSON.stringify(json).slice(0, 300)}` }
  }
  return { ok: true, design: result.data }
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/design-parse-repair.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/design/parse.ts tests/unit/design-parse-repair.test.ts` then `git commit -m "feat(parse): 60s LLM timeout + one repair re-ask on schema failure"` (trailer).

---

### Task 3.14: Add timeout + repair re-ask to the imported-edit and image-describe LLM calls

`parse-import.ts:88` (`generateText` for imported edits) and `describe-image.ts:33-52` lack `abortSignal`; `parse-import.ts` also single-shots JSON/schema parse (`:110-130`). Mirror 3.13: add `AbortSignal.timeout(60_000)` to both, and one repair re-ask in `parse-import.ts`. `describe-image` returns free text (no schema), so it only needs the timeout.

**Files:**
- Modify: `src/lib/design/parse-import.ts:88` (+ parse block ~110-130), `src/lib/prompt/describe-image.ts:33`
- Test: `tests/unit/parse-import-repair.test.ts`

- [ ] **Step 1: Write the failing test** — mock `ai`/model/`@/lib/import/types` and assert the timeout + one repair on bad JSON:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/lib/llm/model', () => ({ getModel: () => ({}) }))

import { parseImportEdit } from '@/lib/design/parse-import'

const input = {
  messages: ['logo na frente'], baseMeshUrl: '/x.3mf', faces: [],
  previewDataUrls: { top: 'd', front: 'd', right: 'd', iso: 'd' },
  previousDesign: null, bboxMm: [10, 10, 10] as [number, number, number],
}

beforeEach(() => generateText.mockReset())

describe('parseImportEdit resilience', () => {
  it('passes a 60s abortSignal on the first call', async () => {
    generateText.mockResolvedValueOnce({ text: '{"kind":"imported","baseMeshUrl":"/x.3mf","edits":[]}' })
    await parseImportEdit(input)
    expect(generateText.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal)
  })
  it('re-asks once on invalid JSON then succeeds', async () => {
    generateText
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: '{"kind":"imported","baseMeshUrl":"/x.3mf","edits":[]}' })
    const d = await parseImportEdit(input)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(d.kind).toBe('imported')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/parse-import-repair.test.ts` — Expected: FAIL (no abortSignal / no repair).
- [ ] **Step 3: Implement.** In `parse-import.ts`, add `abortSignal` to the existing `generateText` call (`:88-108`) and refactor the parse/validate block (`:110-130`) into a reusable `tryParseImport` helper, then add one text-only repair re-ask. Keep the file's existing identifiers (the model getter, system prompt, `maxOutputTokens`, and the schema it already validates against at `:110-130` — shown below as `IMPORT_SCHEMA`/`getModel()`/`SYSTEM`; do NOT rename them, just wrap them):

```ts
  const { text } = await generateText({
    model: getModel(),
    system: SYSTEM,
    prompt, // unchanged — the existing import-edit prompt with previews/faces
    maxOutputTokens: 1200, // keep the file's current value
    abortSignal: AbortSignal.timeout(60_000),
  })

  const first = tryParseImport(text)
  if (first.ok) return first.design

  // One repair re-ask: text-only (no images on the retry — they were already
  // described in `text`'s context), feeding the model its bad output + error.
  const { text: repaired } = await generateText({
    model: getModel(),
    system: SYSTEM,
    prompt:
      `Your previous reply was not a valid imported-edit JSON.\n` +
      `ERROR: ${first.error}\n` +
      `YOUR PREVIOUS REPLY:\n${text.slice(0, 1000)}\n\n` +
      `Reply again with ONLY valid JSON matching the schema. No markdown, no prose.`,
    maxOutputTokens: 1200,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const second = tryParseImport(repaired)
  if (second.ok) return second.design
  throw new Error(second.error)
}

type ImportAttempt = { ok: true; design: ImportEditResult } | { ok: false; error: string }
function tryParseImport(text: string): ImportAttempt {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, error: `parseImportEdit: LLM did not return valid JSON: ${(err as Error).message}\nGot: ${text.slice(0, 200)}` }
  }
  const result = IMPORT_SCHEMA.safeParse(json) // the schema parse-import.ts already uses at :110-130
  if (!result.success) {
    return { ok: false, error: `parseImportEdit: JSON did not match schema: ${result.error.message}\nGot: ${JSON.stringify(json).slice(0, 300)}` }
  }
  return { ok: true, design: result.data }
}
```
`ImportEditResult` is the return type the function already produces (alias it to whatever `parseImportEdit` currently returns — likely the `imported` variant of `Design`). In `describe-image.ts`, add `abortSignal: AbortSignal.timeout(60_000)` to its `generateText` call (`:33-52`); it returns free text, so no repair/parse path is needed.

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/parse-import-repair.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/design/parse-import.ts src/lib/prompt/describe-image.ts tests/unit/parse-import-repair.test.ts` then `git commit -m "feat(llm): 60s timeout on import-edit/describe-image + import repair re-ask"` (trailer).

---

### Phase 3 acceptance gate

- [ ] Run the whole Phase-3 suite — `pnpm test tests/unit/slicer tests/unit/design-watertight.test.ts tests/unit/design-generate.test.ts tests/unit/project-workspace-logo-gate.test.ts tests/unit/project-workspace-history.test.ts tests/unit/chat-badge.test.ts tests/unit/slice-route-precondition.test.ts tests/unit/strip-cache-keys.test.ts tests/unit/reap-stuck-iterations.test.ts tests/unit/design-parse-repair.test.ts tests/unit/parse-import-repair.test.ts` — Expected: all PASS.
- [ ] `pnpm exec tsc --noEmit` — Expected: clean.
- [ ] Smoke: a fresh slice (after the 3.2 slicer redeploy) shows real print-time + filament; a parametric flat_plate with a hole no longer triggers the "não-watertight / 88 buracos" banner (`MeshValidityBanner`).

---

**Cross-phase notes for the executor:**
- **Deploy dependency (Task 3.2):** the slicer metadata fix only takes effect after redeploying the `slicer/` Railway service; the UI fix (3.3) ships with the Next app independently.
- **`apiError` (Phase 4):** Phase 3 routes still return text/JSON `Response`s directly. When Phase 4 lands `src/lib/http/api-error.ts`, the new error returns in 3.6/3.11/3.12 are the first migration candidates — do not pre-build that helper here.
- **Validity finding resolution:** I reproduced it — the analyzer (`validity.ts`) is correct; the **geometry** is genuinely torn by JSCAD's BSP subtract (88 open edges across the whole plate, invariant up to a 10µm weld). The fix is builder-side welding (3.4), consistent with the repo's existing `manifold-csg.ts` `mergeVertices` repair.

---

I have everything I need. `phin@2.9.3` is the vulnerable transitive (deprecated, no patch — the override pins it to `^3.7.1`). Now writing the Phase 4 plan.

## Phase 4 — Backend & security hardening

**Goal:** Make every API route return uniform JSON errors with generic client messages (detail to logs/DB), add structured per-request logging, ship security headers, close the SSRF/traversal gaps in `/api/generate`, sniff upload magic bytes, cap unbounded bodies, pin the two moderate CVEs, and route all secret/config access through `src/env.ts`.

---

### Task 4.1: `apiError` JSON error helper [structural]

**Files:**
- Create: `src/lib/http/api-error.ts`
- Test: `tests/unit/api-error.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest'
import { apiError } from '@/lib/http/api-error'

describe('apiError', () => {
  it('returns a JSON Response with status, code and message', async () => {
    const res = apiError(401, 'unauthenticated', 'Faça login para continuar.')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const body = await res.json()
    expect(body).toEqual({ error: { code: 'unauthenticated', message: 'Faça login para continuar.' } })
  })

  it('optionally carries an iteration_id for the client to poll', async () => {
    const res = apiError(500, 'build_failed', 'Não foi possível gerar a peça.', { iteration_id: 'abc' })
    expect(await res.json()).toEqual({
      error: { code: 'build_failed', message: 'Não foi possível gerar a peça.' },
      iteration_id: 'abc',
    })
  })
})
```
- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/api-error.test.ts` — Expected: FAIL (`Cannot find module '@/lib/http/api-error'`)
- [ ] **Step 3: Implement** — create `src/lib/http/api-error.ts`:
```ts
/**
 * Uniform JSON error envelope for every API route.
 *
 * Clients read `error.code` (stable, machine-readable) and may show
 * `error.message` (generic, user-safe PT-BR — NEVER an LLM/internal string or
 * a raw exception message). Internal detail goes to logs + the DB iteration
 * row, never the wire.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: { code, message }, ...extra }, { status })
}
```
- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/api-error.test.ts` — Expected: PASS
- [ ] **Step 5: Commit** — `git add src/lib/http/api-error.ts tests/unit/api-error.test.ts` then `git commit -m "feat(http): apiError JSON envelope helper"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`)

---

### Task 4.2: Structured logger with per-request id

**Files:**
- Create: `src/lib/log.ts`
- Test: `tests/unit/log.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRequestLogger } from '@/lib/log'

afterEach(() => vi.restoreAllMocks())

describe('createRequestLogger', () => {
  it('emits a structured JSON line tagged with route + a request id', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createRequestLogger('generate')
    log.info('quick modifier matched', { message: 'logo maior' })
    expect(spy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(spy.mock.calls[0][0] as string)
    expect(line.route).toBe('generate')
    expect(line.level).toBe('info')
    expect(line.msg).toBe('quick modifier matched')
    expect(typeof line.reqId).toBe('string')
    expect(line.message).toBe('logo maior')
  })

  it('error() serialises an Error to message + stack, routes to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createRequestLogger('flexify')
    log.error('flexify failed', new Error('boom'))
    const line = JSON.parse(spy.mock.calls[0][0] as string)
    expect(line.level).toBe('error')
    expect(line.err.message).toBe('boom')
    expect(typeof line.err.stack).toBe('string')
  })

  it('reuses the same reqId across calls from one logger', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createRequestLogger('slice')
    log.info('a'); log.info('b')
    const a = JSON.parse(spy.mock.calls[0][0] as string)
    const b = JSON.parse(spy.mock.calls[1][0] as string)
    expect(a.reqId).toBe(b.reqId)
  })
})
```
- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/log.test.ts` — Expected: FAIL (`Cannot find module '@/lib/log'`)
- [ ] **Step 3: Implement** — create `src/lib/log.ts`. Tagged wrapper over `console` (zero deps, no pino; Next runtime already ships JSON-line-friendly stdout to Railway):
```ts
import { randomUUID } from 'node:crypto'

type Level = 'info' | 'warn' | 'error'

function serializeErr(err: unknown) {
  if (err instanceof Error) return { message: err.message, stack: err.stack }
  return { message: String(err) }
}

export interface RequestLogger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, err?: unknown, fields?: Record<string, unknown>): void
}

/** One logger per request. `reqId` correlates every line of a single handler. */
export function createRequestLogger(route: string, reqId = randomUUID()): RequestLogger {
  function emit(level: Level, msg: string, extra: Record<string, unknown>) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, route, reqId, msg, ...extra })
    if (level === 'error') console.error(line)
    else console.log(line)
  }
  return {
    info: (msg, fields = {}) => emit('info', msg, fields),
    warn: (msg, fields = {}) => emit('warn', msg, fields),
    error: (msg, err, fields = {}) => emit('error', msg, { ...(err !== undefined ? { err: serializeErr(err) } : {}), ...fields }),
  }
}
```
- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/log.test.ts` — Expected: PASS
- [ ] **Step 5: Commit** — `git add src/lib/log.ts tests/unit/log.test.ts` then `git commit -m "feat(log): structured per-request logger"` (trailer)

---

### Task 4.3: Adopt `apiError` + logger in `/api/slice` [structural]

**Files:**
- Modify: `src/app/api/slice/route.ts:1-92`

This route currently returns text via `new Response(...)` at lines 21, 24, 33, 49, 60, 62 — each becomes `apiError(...)`. The `(structural)` tag is because `/api/slice` response shape is in the cross-cutting checkpoint list.

- [ ] **Step 1: Verification is the prod-build smoke + the route's own behavior** (no unit test — route handlers aren't unit-mounted here; the shape is exercised by the E2E suite from Phase 2). Manual probe after Step 3:
  - `curl -s -X POST localhost:3001/api/slice -H 'content-type: application/json' -d '{}' | jq` — Expected: `{ "error": { "code": "invalid_body", "message": "..." } }` with HTTP 400.
- [ ] **Step 2: (n/a — covered by Step 1 probe)**
- [ ] **Step 3: Implement** — edit `src/app/api/slice/route.ts`:
  - Add imports after line 7:
```ts
import { apiError } from '@/lib/http/api-error'
import { createRequestLogger } from '@/lib/log'
```
  - Replace the auth + body guards (current lines 20-25):
```ts
  const log = createRequestLogger('slice')
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')
  const { iterationId, stlBase64 } = parsed.data
```
  - Replace the not-found (current line 33): `if (!row) return apiError(404, 'not_found', 'Iteração não encontrada.')`
  - Replace the 3MF-convert catch (current lines 48-50): log detail, return generic:
```ts
    } catch (e) {
      log.error('3mf->stl convert failed', e, { iterationId })
      return apiError(422, 'mesh_convert_failed', 'Não foi possível preparar a malha para o fatiamento.')
    }
```
  - Replace the slicer error branch (current lines 56-63):
```ts
  } catch (e) {
    log.error('slice failed', e, { iterationId })
    if (e instanceof SlicerError) {
      return e.kind === 'slicer'
        ? apiError(502, 'slicer_failed', 'O fatiador falhou ao processar a malha.')
        : apiError(503, 'slicer_unavailable', 'O fatiador está indisponível no momento.')
    }
    return apiError(502, 'slicer_failed', 'O fatiador falhou ao processar a malha.')
  }
```
- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit` (0 errors) and the Step 1 curl probe returns the JSON envelope.
- [ ] **Step 5: Commit** — `git add src/app/api/slice/route.ts` then `git commit -m "refactor(api/slice): apiError envelope + structured logging"` (trailer)

---

### Task 4.4: Adopt `apiError` + logger in `/api/flexify` [structural]

**Files:**
- Modify: `src/app/api/flexify/route.ts:84-159`

Text returns at lines 86, 89, 97, 116, 126; the `console.error` at 151. Flexify already returns a *generic* JSON message at 155-158 — convert that to `apiError` too for shape consistency.

- [ ] **Step 1: Verification** (route handler, E2E-covered). Manual probe after Step 3:
  - `curl -s -X POST localhost:3001/api/flexify -d '{}' -H 'content-type: application/json' | jq` — Expected HTTP 400, `{ "error": { "code": "invalid_body", ... } }`.
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement** — edit `src/app/api/flexify/route.ts`:
  - Add imports after line 23: `import { apiError } from '@/lib/http/api-error'` and `import { createRequestLogger } from '@/lib/log'`.
  - In `POST`, after line 85 add `const log = createRequestLogger('flexify')`; then:
    - line 86 → `if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')`
    - line 89 → `if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')`
    - line 97 → `if (!project) return apiError(404, 'not_found', 'Projeto não encontrado.')`
    - line 116 → `return apiError(403, 'forbidden_mesh', 'A malha não pertence a este projeto.')`
    - line 126 → `return apiError(400, 'no_source_mesh', 'Gere ou envie uma malha antes de articular.')`
  - Replace the catch (current 148-159):
```ts
  } catch (err) {
    log.error('flexify failed', err, { projectId, iterationId: iteration.id })
    await db.update(iterations)
      .set({ status: 'failed', error: `flexify failed: ${(err as Error).message}` })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'flexify_failed', 'Falha ao processar a malha.', { iteration_id: iteration.id })
  }
```
  - Remove the now-unused local `const e = err as Error` lines from that block.
- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit` (0) + Step 1 probe.
- [ ] **Step 5: Commit** — `git add src/app/api/flexify/route.ts` then `git commit -m "refactor(api/flexify): apiError envelope + structured logging"` (trailer)

---

### Task 4.5: Adopt `apiError` + logger in `/api/upload` and `/api/slicer-health` [structural]

**Files:**
- Modify: `src/app/api/upload/route.ts:19-37`
- Modify: `src/app/api/slicer-health/route.ts:13-15`

- [ ] **Step 1: Verification** — after Step 3:
  - `curl -s localhost:3001/api/slicer-health | jq` while logged out — Expected HTTP 401 `{ "error": { "code": "unauthenticated", ... } }`.
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement**:
  - `src/app/api/upload/route.ts`: add `import { apiError } from '@/lib/http/api-error'`.
    - line 21 → `if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')`
    - line 25 → `if (!(file instanceof File)) return apiError(400, 'no_file', 'Nenhum arquivo enviado.')`
    - line 31 → `return apiError(415, 'unsupported_type', 'Tipo de arquivo não suportado.')`
    - line 37 → `return apiError(413, 'file_too_large', \`Arquivo muito grande (>${mb}MB).\`)`
  - `src/app/api/slicer-health/route.ts`: add the import; line 15 → `if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')`
- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit` (0) + Step 1 probe.
- [ ] **Step 5: Commit** — `git add src/app/api/upload/route.ts src/app/api/slicer-health/route.ts` then `git commit -m "refactor(api): apiError on upload + slicer-health"` (trailer)

---

### Task 4.6: Adopt `apiError` + logger in `/api/generate`; stop leaking exception text [structural]

**Files:**
- Modify: `src/app/api/generate/route.ts:65-368`

Today this route leaks raw exception/LLM text to the client at lines 184 (`error: 'Imported edit requires...'` — fine, static), **201-203** (`Failed to load base mesh: ${e.message}`), **287** (`error: e.message`), **313** (Meshy `error: meshy.error`), **326** (`error: e.message`). All `e.message`/`meshy.error` paths must become generic client text with detail in logs/DB only. Also swaps text returns at 67, 70, 78 and the 6 `console.*` calls.

- [ ] **Step 1: Verification** — `/api/generate` is the marquee `(structural)` checkpoint. After Step 3, prod-build smoke probe:
  - `curl -s -X POST localhost:3001/api/generate -H 'content-type: application/json' -d '{}' | jq` — Expected HTTP 400 `{ "error": { "code": "invalid_body", ... } }`.
  - Confirm a forced build-failure response carries `error.message` that is generic (no stack/`e.message`) and includes `iteration_id`.
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement** — edit `src/app/api/generate/route.ts`:
  - Add imports after line 31: `import { apiError } from '@/lib/http/api-error'` and `import { createRequestLogger } from '@/lib/log'`.
  - After line 66 (`const session = await auth()` becomes second line) add the logger and convert guards:
```ts
  const log = createRequestLogger('generate')
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')
```
  - line 78 → `if (!project) return apiError(404, 'not_found', 'Projeto não encontrado.')`
  - line 122 → `log.error('describeImage failed (continuing)', err, { iterationId: iteration.id })`
  - line 139 → `log.error('image fetch failed (continuing without logo)', err, { iterationId: iteration.id })`
  - Missing-previews branch (current 180-186): keep DB write; replace the return with
```ts
        return apiError(400, 'previews_required', 'A edição de malha importada exige as pré-visualizações (o cliente deve capturá-las e enviá-las no primeiro pedido).', { iteration_id: iteration.id })
```
  - base-mesh load catch (current 194-204): log detail, generic client msg:
```ts
    } catch (err) {
      log.error('base mesh load/segment failed', err, { iterationId: iteration.id, meshUrl: effectiveMeshUrl })
      await db.update(iterations)
        .set({ status: 'failed', error: `base mesh load failed: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return apiError(500, 'base_mesh_failed', 'Não foi possível carregar a malha base.', { iteration_id: iteration.id })
    }
```
  - logoPlacement-without-mesh (current 226-234) → `return apiError(400, 'no_imported_mesh', 'Nenhuma malha importada para posicionar o logo.', { iteration_id: iteration.id })`
  - line 262 → `log.info('quick modifier matched', { message })`
  - line 279 → `log.info('design clamped', { source: designSource, adjustments: designAdjustments })`
  - parseDesign catch (current 281-288): log + generic:
```ts
  } catch (err) {
    log.error('parseDesign failed', err, { iterationId: iteration.id })
    await db.update(iterations)
      .set({ status: 'failed', error: `design parse failed: ${(err as Error).message}` })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'design_parse_failed', 'Não foi possível interpretar o pedido.', { iteration_id: iteration.id })
  }
```
  - Meshy-not-configured (current 296-304) → `return apiError(503, 'freeform_unavailable', 'A geração freeform não está configurada.', { iteration_id: iteration.id })`
  - Meshy-failed (current 309-314): `log.error('meshy failed', new Error(meshy.error), { iterationId: iteration.id })` then `return apiError(502, 'meshy_failed', 'A geração freeform falhou.', { iteration_id: iteration.id })`
  - generator catch (current 320-327):
```ts
    } catch (err) {
      log.error('generator failed', err, { iterationId: iteration.id })
      await db.update(iterations)
        .set({ status: 'failed', error: `build failed: ${(err as Error).message}` })
        .where(eq(iterations.id, iteration.id))
      return apiError(500, 'build_failed', 'Não foi possível gerar a peça.', { iteration_id: iteration.id })
    }
```
  - The success `Response.json(...)` at 355-367 is UNCHANGED (success shape stays; only error shapes change).
- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit` (0 errors) + Step 1 probes; `pnpm test` still green.
- [ ] **Step 5: Commit** — `git add src/app/api/generate/route.ts` then `git commit -m "refactor(api/generate): apiError envelope, generic client errors, structured logging"` (trailer)

---

### Task 4.7: Security headers in `next.config.ts`

**Files:**
- Modify: `next.config.ts:1-16`

CSP scope verified: the browser bundle is R3F/three/drei (no `eval`/`new Function` in `src/components/**`); **manifold-3d WASM runs server-side only** (`src/lib/import/manifold-csg.ts` + `add-logo.ts`, reached via dynamic import in API routes — it is in `serverExternalPackages`), so **no `wasm-unsafe-eval` is needed in the client CSP**. Next.js dev/HMR does need `'unsafe-eval'`, so gate `script-src` on `NODE_ENV`. Meshes are fetched from the blob origin (`*.public.blob.vercel-storage.com`) and same-origin (`/meshes/...`), so `connect-src`/`img-src` must allow blob storage; data: URLs are used for previews and image inlining (`img-src data:`).

- [ ] **Step 1: Verification** (config — no unit test). After Step 3, build + probe:
  - `pnpm build && pnpm start` then `curl -sI localhost:3000/sign-in | grep -iE 'content-security-policy|x-frame-options|x-content-type|referrer-policy|strict-transport'` — Expected: all five headers present; CSP has no `'unsafe-eval'` in a production build.
  - Manual viewport check: load a project, confirm the 3D viewer renders (no CSP console violation blocking three.js or blob mesh fetch).
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement** — replace `next.config.ts`:
```ts
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production'

// Mesh/preview bytes come from Vercel Blob; three.js + textures may use blob:/data:.
const BLOB = 'https://*.public.blob.vercel-storage.com'

const csp = [
  `default-src 'self'`,
  // Dev/HMR needs unsafe-eval (React Refresh); prod build does not. No client WASM
  // (manifold runs server-side), so no wasm-unsafe-eval required.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${BLOB}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${BLOB}${isDev ? ' ws:' : ''}`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-ancestors 'none'`,
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  devIndicators: {
    position: 'bottom-right',
  },
  serverExternalPackages: ['potrace', 'jimp', 'sharp', '@jscad/modeling', 'manifold-3d'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;
```
- [ ] **Step 4: Verify** — the Step 1 build + `curl -I` shows all five headers; viewer renders without CSP violations.
- [ ] **Step 5: Commit** — `git add next.config.ts` then `git commit -m "feat(security): CSP + XFO/nosniff/referrer/HSTS headers"` (trailer)

---

### Task 4.8: `isPublicUrl()` SSRF guard for external `imageUrl`

**Files:**
- Create: `src/lib/http/is-public-url.ts`
- Test: `tests/unit/is-public-url.test.ts`

`/api/generate` legitimately fetches a user-supplied external `imageUrl` (route.ts:131-134). Block private/link-local/loopback/metadata ranges before that fetch.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest'
import { isPublicUrl } from '@/lib/http/is-public-url'

describe('isPublicUrl', () => {
  it('allows ordinary public https hosts', () => {
    expect(isPublicUrl('https://example.com/logo.png')).toBe(true)
  })
  it('rejects loopback', () => {
    expect(isPublicUrl('http://127.0.0.1/x')).toBe(false)
    expect(isPublicUrl('http://localhost/x')).toBe(false)
    expect(isPublicUrl('http://[::1]/x')).toBe(false)
  })
  it('rejects private + link-local + metadata ranges', () => {
    expect(isPublicUrl('http://10.0.0.5/x')).toBe(false)
    expect(isPublicUrl('http://192.168.1.1/x')).toBe(false)
    expect(isPublicUrl('http://172.16.0.1/x')).toBe(false)
    expect(isPublicUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
  })
  it('rejects non-http(s) schemes', () => {
    expect(isPublicUrl('file:///etc/passwd')).toBe(false)
    expect(isPublicUrl('ftp://example.com/x')).toBe(false)
    expect(isPublicUrl('not a url')).toBe(false)
  })
})
```
- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/is-public-url.test.ts` — Expected: FAIL (module missing)
- [ ] **Step 3: Implement** — create `src/lib/http/is-public-url.ts`:
```ts
/**
 * SSRF guard for user-supplied external URLs (e.g. /api/generate imageUrl).
 *
 * Only http(s) on a host that is NOT loopback / private / link-local / CGNAT /
 * the cloud metadata IP. Hostname-literal IPs are checked directly; DNS-name
 * hosts pass the literal check (a resolving attacker would need a public IP,
 * and fetch is called with redirect:'manual' to stop redirect-to-internal).
 */
function isBlockedIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true            // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true    // 172.16/12
  if (a === 100 && b >= 64 && b <= 127) return true   // 100.64/10 CGNAT
  return false
}

export function isPublicUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host === '::1' || host === '[::1]') return false
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false // ULA + IPv6 link-local
  if (isBlockedIPv4(host)) return false
  return true
}
```
- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/is-public-url.test.ts` — Expected: PASS
- [ ] **Step 5: Commit** — `git add src/lib/http/is-public-url.ts tests/unit/is-public-url.test.ts` then `git commit -m "feat(security): isPublicUrl SSRF guard"` (trailer)

---

### Task 4.9: Wire SSRF + traversal guards into `/api/generate` [structural]

**Files:**
- Modify: `src/app/api/generate/route.ts:128-168` (image fetch + base-mesh resolution)

Three gaps: (1) `imageUrl` is fetched at 131-134 with no SSRF check; (2) `meshUrl` (`freshMeshUrl`) is accepted at 153 with **no `ownMeshUrls` membership check** (flexify has one at route.ts:108-118); (3) the local-file branches at generate route.ts:136 read `public/<imageUrl>` with no realpath containment (flexify has the guard at flexify route.ts:73-77).

- [ ] **Step 1: Verification** — SSRF probe after Step 3 (route is `(structural)`, E2E-covered):
  - `curl -s -X POST localhost:3001/api/generate -H 'content-type: application/json' -d '{"projectId":"<owned-uuid>","message":"x","imageUrl":"http://169.254.169.254/latest/meta-data"}'` (with a valid session cookie) — Expected HTTP 400 `{ "error": { "code": "invalid_image_url", ... } }`, and NO outbound fetch to the metadata IP in logs.
  - Same with a `meshUrl` not in this project — Expected HTTP 403 `forbidden_mesh`.
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement** — edit `src/app/api/generate/route.ts`:
  - Add imports (after line 31): `import { isPublicUrl } from '@/lib/http/is-public-url'`, and add `realpath` + `sep` to the node imports — change line 29-30 to:
```ts
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
```
  - **(2) meshUrl membership** — after the `history` query (current line 85) and before line 87, build the owned-mesh set and reject a foreign `freshMeshUrl`:
```ts
  const ownMeshUrls = new Set(history.flatMap((h) => (h.meshBlobUrl ? [h.meshBlobUrl] : [])))
  if (freshMeshUrl && !ownMeshUrls.has(freshMeshUrl)) {
    return apiError(403, 'forbidden_mesh', 'A malha não pertence a este projeto.')
  }
```
  (Placed before the iteration row insert so we reject without writing a `generating` row.)
  - **(1) imageUrl SSRF** — in the image-fetch block (current 131-134), guard the http branch:
```ts
      if (effectiveImageUrl.startsWith('http')) {
        if (!isPublicUrl(effectiveImageUrl)) throw new Error('imageUrl not allowed')
        const r = await fetch(effectiveImageUrl, { redirect: 'manual' })
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        logoImageBuffer = Buffer.from(await r.arrayBuffer())
```
  Note: this throw is caught by the existing try (logs + continues without logo), which is acceptable — a blocked URL simply yields no logo. To make it a hard 400 instead, validate `imageUrl` up front (right after destructuring at line 71): `if (imageUrl && imageUrl.startsWith('http') && !isPublicUrl(imageUrl)) return apiError(400, 'invalid_image_url', 'URL de imagem não permitida.')`. **Use the up-front 400** (matches the Step 1 probe).
  - **(3) local-file traversal** — replace the local-file branch (current line 136) with a realpath-contained read mirroring flexify route.ts:70-81:
```ts
      } else {
        const publicDir = join(process.cwd(), 'public')
        const rel = effectiveImageUrl.startsWith('/') ? effectiveImageUrl.slice(1) : effectiveImageUrl
        const real = await realpath(join(publicDir, rel))
        if (real !== publicDir && !real.startsWith(publicDir + sep)) {
          throw new Error('image path escapes public dir')
        }
        logoImageBuffer = await readFile(real)
      }
```
- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit` (0) + the two Step 1 probes; `pnpm test` green.
- [ ] **Step 5: Commit** — `git add src/app/api/generate/route.ts` then `git commit -m "fix(security): SSRF + traversal guards on /api/generate image/mesh inputs"` (trailer)

---

### Task 4.10: Realpath traversal guard in `describe-image.ts` and `load-base-mesh.ts`

**Files:**
- Modify: `src/lib/prompt/describe-image.ts:22-28`
- Modify: `src/lib/import/load-base-mesh.ts:16-21`
- Test: `tests/unit/path-containment.test.ts`

Both read `public/<relative>` from a user-influenced URL with no containment check (describe-image.ts:23, load-base-mesh.ts:20). Extract a shared guard and apply it.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest'
import { resolveInsidePublic } from '@/lib/http/resolve-inside-public'

describe('resolveInsidePublic', () => {
  it('resolves a normal public-relative path', () => {
    const p = resolveInsidePublic('/uploads/abc.png')
    expect(p.endsWith('/public/uploads/abc.png')).toBe(true)
  })
  it('throws on traversal that escapes public/', () => {
    expect(() => resolveInsidePublic('/../../etc/passwd')).toThrow(/escapes/)
    expect(() => resolveInsidePublic('/uploads/../../../secret')).toThrow(/escapes/)
  })
})
```
- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/path-containment.test.ts` — Expected: FAIL (module missing)
- [ ] **Step 3: Implement**:
  - Create `src/lib/http/resolve-inside-public.ts` (uses `resolve`, no FS so it stays sync + unit-testable; the real-symlink check stays inline in the async callers where a `realpath` is already needed):
```ts
import { join, resolve, sep } from 'node:path'

/**
 * Resolve a public-relative URL path (e.g. `/uploads/x.png`) to an absolute
 * path under `public/`, throwing if normalisation escapes that root.
 * Pair with `realpath` in async callers to also defeat symlink escapes.
 */
export function resolveInsidePublic(url: string): string {
  const publicDir = join(process.cwd(), 'public')
  const rel = url.startsWith('/') ? url.slice(1) : url
  const abs = resolve(publicDir, rel)
  if (abs !== publicDir && !abs.startsWith(publicDir + sep)) {
    throw new Error('path escapes the public directory')
  }
  return abs
}
```
  - `src/lib/prompt/describe-image.ts`: add `import { resolveInsidePublic } from '@/lib/http/resolve-inside-public'`; replace line 23 (`const filePath = join(process.cwd(), 'public', imageUrl)`) with `const filePath = resolveInsidePublic(imageUrl)`.
  - `src/lib/import/load-base-mesh.ts`: add the import; replace the local branch (current 19-20):
```ts
    const filePath = resolveInsidePublic(url)
    buf = new Uint8Array(await readFile(filePath))
```
- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/path-containment.test.ts` — Expected: PASS; `pnpm exec tsc --noEmit` 0.
- [ ] **Step 5: Commit** — `git add src/lib/http/resolve-inside-public.ts src/lib/prompt/describe-image.ts src/lib/import/load-base-mesh.ts tests/unit/path-containment.test.ts` then `git commit -m "fix(security): path-containment guard on public file reads"` (trailer)

---

### Task 4.11: Cap the unbounded `previewDataUrls` request body (`generate`) [structural]

**Files:**
- Modify: `src/app/api/generate/route.ts:36,43-48`

> **Note (ordering):** Task 3.6 (Phase 3, already shipped before this phase) DROPPED `stlBase64` from the `/api/slice` `Body` — the slice route now takes only `{ iterationId }` and slices the server-persisted mesh, so there is no client-supplied byte payload left to cap there. This task therefore caps ONLY the four `previewDataUrls` data-URL strings on `/api/generate`, which are still unbounded `z.string()`. Previews are PNG data URLs; cap each at 8MB.

- [ ] **Step 1: Write the failing test** — `tests/unit/body-caps.test.ts`. The schema is module-local `const Body`; export it so the test can import it.
```ts
import { describe, it, expect } from 'vitest'
import { Body as GenerateBody } from '@/app/api/generate/route'

describe('generate request body caps', () => {
  it('rejects an oversized preview data URL', () => {
    const big = 'd'.repeat(8 * 1024 * 1024 + 1)
    const r = GenerateBody.safeParse({
      projectId: crypto.randomUUID(),
      message: 'x',
      previewDataUrls: { top: big, front: 'x', right: 'x', iso: 'x' },
    })
    expect(r.success).toBe(false)
  })
  it('accepts previews under the cap', () => {
    const r = GenerateBody.safeParse({
      projectId: crypto.randomUUID(),
      message: 'x',
      previewDataUrls: { top: 'x', front: 'x', right: 'x', iso: 'x' },
    })
    expect(r.success).toBe(true)
  })
})
```
- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/body-caps.test.ts` — Expected: FAIL (`Body` not exported / cap absent; oversized still parses)
- [ ] **Step 3: Implement** — in `src/app/api/generate/route.ts`, change `const Body =` to `export const Body =` (line 36) and cap each preview string (lines 43-48):
```ts
const MAX_PREVIEW = 8 * 1024 * 1024
// ...
  previewDataUrls: z.object({
    top: z.string().max(MAX_PREVIEW),
    front: z.string().max(MAX_PREVIEW),
    right: z.string().max(MAX_PREVIEW),
    iso: z.string().max(MAX_PREVIEW),
  }).optional(),
```
- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/body-caps.test.ts` — Expected: PASS; `pnpm exec tsc --noEmit` 0.
- [ ] **Step 5: Commit** — `git add src/app/api/generate/route.ts tests/unit/body-caps.test.ts` then `git commit -m "feat(security): cap previewDataUrls request body size"` (trailer)

---

### Task 4.12: Magic-byte sniff on `/api/upload` [structural]

**Files:**
- Create: `src/lib/http/sniff-magic-bytes.ts`
- Modify: `src/app/api/upload/route.ts:40-46`
- Test: `tests/unit/sniff-magic-bytes.test.ts`

Upload trusts `file.type` / extension. Sniff the buffer: PNG `89 50 4E 47`, JPEG `FF D8`, WebP `52 49 46 46 ... 57 45 42 50` (RIFF/WEBP), ZIP/3MF `50 4B` (`PK`).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest'
import { sniffKind } from '@/lib/http/sniff-magic-bytes'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])

describe('sniffKind', () => {
  it('detects png/jpeg/webp as image', () => {
    expect(sniffKind(png)).toBe('image')
    expect(sniffKind(jpeg)).toBe('image')
    expect(sniffKind(webp)).toBe('image')
  })
  it('detects zip/3mf as mesh', () => {
    expect(sniffKind(zip)).toBe('mesh')
  })
  it('returns null for unknown bytes', () => {
    expect(sniffKind(Buffer.from('not a real file'))).toBeNull()
  })
})
```
- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/sniff-magic-bytes.test.ts` — Expected: FAIL (module missing)
- [ ] **Step 3: Implement**:
  - Create `src/lib/http/sniff-magic-bytes.ts`:
```ts
/** Identify a file by its leading bytes (don't trust browser MIME). */
export function sniffKind(buf: Uint8Array): 'image' | 'mesh' | null {
  const b = buf
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'
  // JPEG: FF D8
  if (b[0] === 0xff && b[1] === 0xd8) return 'image'
  // WebP: 'RIFF' .... 'WEBP'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image'
  // ZIP / 3MF (OPC): 'PK'
  if (b[0] === 0x50 && b[1] === 0x4b) return 'mesh'
  return null
}
```
  - `src/app/api/upload/route.ts`: after computing `bytes` (current line 45) and before the `isMesh ? '3mf' : ...` ext block, verify the sniff matches the declared kind:
```ts
  const bytes = Buffer.from(await file.arrayBuffer())
  const sniffed = sniffKind(bytes)
  if (sniffed === null || (isMesh && sniffed !== 'mesh') || (isImage && sniffed !== 'image')) {
    return apiError(415, 'content_mismatch', 'O conteúdo do arquivo não corresponde ao tipo declarado.')
  }
```
  Add `import { sniffKind } from '@/lib/http/sniff-magic-bytes'` (and `apiError` is already imported from Task 4.5).
- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/sniff-magic-bytes.test.ts` — Expected: PASS; `pnpm exec tsc --noEmit` 0.
- [ ] **Step 5: Commit** — `git add src/lib/http/sniff-magic-bytes.ts src/app/api/upload/route.ts tests/unit/sniff-magic-bytes.test.ts` then `git commit -m "feat(security): magic-byte sniff on upload"` (trailer)

---

### Task 4.13: Route secret/config access through `src/env.ts` [structural]

**Files:**
- Modify: `src/env.ts:9-14` (no key additions needed — verify)
- Modify: `src/app/api/generate/route.ts:305,379`
- Modify: `src/app/api/flexify/route.ts:189`
- Modify: `src/app/api/slice/route.ts:69`
- Modify: `src/app/api/upload/route.ts:48`
- Modify: `src/lib/llm/model.ts:20,23,36,39`
- Modify: `src/lib/meshy/client.ts:9`

`src/env.ts` already exports `MESHY_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `AI_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY` (verified, lines 9-14) — no schema change required. Replace the 10 raw `process.env.*` reads.

- [ ] **Step 1: Verification** — grep proves the bypass is gone. After Step 3:
  - `grep -rn "process.env.MESHY_API_KEY\|process.env.BLOB_READ_WRITE_TOKEN\|process.env.AI_GATEWAY_API_KEY\|process.env.ANTHROPIC_API_KEY" src/` — Expected: **no matches**.
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement** — add `import { env } from '@/env'` to each file that lacks it, then:
  - `generate/route.ts:305` → `const apiKey = env.MESHY_API_KEY as string`; `:379` → `if (env.BLOB_READ_WRITE_TOKEN) {`
  - `flexify/route.ts:189` → `if (env.BLOB_READ_WRITE_TOKEN) {`
  - `slice/route.ts:69` → `if (env.BLOB_READ_WRITE_TOKEN) {`
  - `upload/route.ts:48` → `if (env.BLOB_READ_WRITE_TOKEN) {`
  - `llm/model.ts`: `:20,36` → `if (env.AI_GATEWAY_API_KEY)`; `:23,39` → `if (env.ANTHROPIC_API_KEY)` (add `import { env } from '@/env'`).
  - `meshy/client.ts:9` → `return !!env.MESHY_API_KEY` (add the import).
  - Note for `meshy/client.ts`: the `@vercel/blob put` calls still read `BLOB_READ_WRITE_TOKEN` from the ambient env internally — that is the library's own contract and is left untouched; only our explicit `if` gates switch to `env`.
- [ ] **Step 4: Verify** — the Step 1 grep is clean; `pnpm exec tsc --noEmit` 0; `pnpm test` green (env keys are loaded via `tests/setup-env.ts` → `.env.local`).
- [ ] **Step 5: Commit** — `git add src/app/api/generate/route.ts src/app/api/flexify/route.ts src/app/api/slice/route.ts src/app/api/upload/route.ts src/lib/llm/model.ts src/lib/meshy/client.ts` then `git commit -m "refactor(env): route secret access through src/env.ts"` (trailer)

---

### Task 4.14: Pin moderate transitive deps (`postcss`, `phin`) via pnpm overrides

**Files:**
- Modify: `package.json:1-16` (add a top-level `pnpm.overrides` block)

Lockfile confirms the vulnerable copies coexist: `postcss@8.4.31` (pnpm-lock.yaml:3172, <8.5.10) and `phin@2.9.3` (pnpm-lock.yaml:3127, deprecated/vulnerable). Pin both forward.

- [ ] **Step 1: Verification** — `pnpm audit --prod` before, to capture the two moderates as baseline:
  - `pnpm audit --prod` — Expected (before): reports the postcss + phin moderates.
- [ ] **Step 2: (n/a)**
- [ ] **Step 3: Implement** — add to `package.json` (after the `"devDependencies"` block, before the closing brace):
```json
  "pnpm": {
    "overrides": {
      "postcss@<8.5.10": ">=8.5.10",
      "phin@<3.7.1": ">=3.7.1"
    }
  }
```
  Then `pnpm install` to rewrite `pnpm-lock.yaml`.
- [ ] **Step 4: Verify** — `pnpm audit --prod` — Expected: the postcss + phin moderates are gone; `grep -n "postcss@8.4.31\|phin@2.9.3" pnpm-lock.yaml` returns nothing; `pnpm exec tsc --noEmit` 0 and `pnpm build` succeeds (postcss/tailwind still build).
- [ ] **Step 5: Commit** — `git add package.json pnpm-lock.yaml` then `git commit -m "chore(deps): pin postcss>=8.5.10 + phin>=3.7.1 via overrides"` (trailer)

---

I now have all the grounding I need. Note the key tension on finding 7: `design.kind` values (`flat_plate`, `disc`, etc.) don't fit the `strategy` enum `['parametric','generative']` — the spec offers "or document the column as legacy". I'll write the plan to widen the column and write the real kind via a typed mapping, since that's what "write the real design kind" asks. Let me produce the phase plan.

## Phase 5 — Data & domain integrity (migration + cleanup)

**Goal:** One Drizzle migration (indexes, FK on `current_iteration_id`, drop dead `parent_iteration_id`, CHECK constraints on text enums, `timestamptz`), project the heavy history selects, plus data-hygiene scripts (orphan-mesh sweep + a `del()` blob helper) and a one-off backfill — all verified by a fresh-DB replay.

---

### Task 5.1: Project history columns on the project page read (drop `validation_report`/`jscad_code` from the list select) (structural)

The history select at `src/app/projects/[id]/page.tsx:24-28` does `select()` (all columns), pulling `validation_report` jsonb (rows ≤806KB with cached `_faces`/`_previews`) on every project open. `ProjectWorkspace` only needs a subset. This is a response-shape change for the `initialHistory` prop, hence (structural).

**Files:**
- Modify: `src/app/projects/[id]/page.tsx:24-28`
- Modify: `src/components/ProjectWorkspace.tsx` (prop type for `initialHistory`, only if it currently expects the full row)
- Test: `tests/unit/project-history-projection.test.ts`

- [ ] **Step 1: Write the failing test** — assert the projected column set excludes `validationReport` and `jscadCode` is kept (Chat replays parametric `jscadCode`). Since the select is inline in a server component, extract the column map to a tiny exported helper and test that.

```ts
// tests/unit/project-history-projection.test.ts
import { describe, it, expect } from 'vitest'
import { historyColumns } from '@/db/history-columns'

describe('project history projection', () => {
  it('omits the heavy validation_report jsonb from list reads', () => {
    expect(historyColumns).not.toHaveProperty('validationReport')
  })
  it('keeps the columns the workspace renders', () => {
    for (const k of [
      'id', 'projectId', 'userMessage', 'imageBlobUrl', 'jscadCode',
      'strategy', 'meshBlobUrl', 'status', 'error', 'slicedBlobUrl',
      'slicedMeta', 'slicedAt', 'baseMode', 'createdAt',
    ]) {
      expect(historyColumns).toHaveProperty(k)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/project-history-projection.test.ts` — Expected: FAIL with `Cannot find module '@/db/history-columns'`.
- [ ] **Step 3: Implement** — create the column map and use it in the page select.

```ts
// src/db/history-columns.ts
import { iterations } from '@/db/schema'

// List/replay reads never need validation_report (jsonb, ≤806KB with cached
// _faces/_previews). generate/route.ts re-reads it on the iterate path via its
// own full select; the workspace only needs these.
export const historyColumns = {
  id: iterations.id,
  projectId: iterations.projectId,
  userMessage: iterations.userMessage,
  imageBlobUrl: iterations.imageBlobUrl,
  jscadCode: iterations.jscadCode,
  strategy: iterations.strategy,
  meshBlobUrl: iterations.meshBlobUrl,
  status: iterations.status,
  error: iterations.error,
  slicedBlobUrl: iterations.slicedBlobUrl,
  slicedMeta: iterations.slicedMeta,
  slicedAt: iterations.slicedAt,
  baseMode: iterations.baseMode,
  imageDescription: iterations.imageDescription,
  createdAt: iterations.createdAt,
} as const
```

Then in `src/app/projects/[id]/page.tsx:24-28` replace `.select()` with `.select(historyColumns)` (import it). Verify the `ProjectWorkspace` `initialHistory` prop type still satisfies — if it was typed as the full inferred row, narrow it to `Pick<...>` or the inferred `select` type so tsc stays green.

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/project-history-projection.test.ts` — Expected: PASS. Then `npx tsc --noEmit` — Expected: 0 errors.
- [ ] **Step 5: Commit** — `git add src/db/history-columns.ts src/app/projects/\[id\]/page.tsx src/components/ProjectWorkspace.tsx tests/unit/project-history-projection.test.ts` then `git commit -m "perf(db): project history list select, drop validation_report jsonb"` (trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 5.2: Widen `strategy` enum + write the real design kind (structural)

`schema.ts:64` types `strategy` as `enum: ['parametric', 'generative']`, but four call sites hardcode `'generative'` (`generate/route.ts:109,356`; `flexify/route.ts:135,175`) regardless of `design.kind` (`hollow_cylinder`/`flat_plate`/`disc`/`bookmark`/`pin`/`custom_keychain`/`mug`/`imported`/`composite`/`freeform`/`flexified`). The column is pure drift today. Widen the enum to the real kind union and write it. (structural: changes a column's value-domain + the inserts.)

**Files:**
- Modify: `src/db/schema.ts:64-66`
- Modify: `src/app/api/generate/route.ts:103-112` (insert), `:344-350` (success update)
- Modify: `src/app/api/flexify/route.ts:129-137` (insert)
- Test: `tests/unit/strategy-kind.test.ts`

- [ ] **Step 1: Write the failing test** — assert the schema's `strategy` column accepts every real kind, and add a pure `designKindToStrategy` mapper.

```ts
// tests/unit/strategy-kind.test.ts
import { describe, it, expect } from 'vitest'
import { iterationStrategies, designKindToStrategy } from '@/db/strategy'

describe('strategy column reflects real design kind', () => {
  it('enumerates every Design kind plus flexified', () => {
    for (const k of [
      'hollow_cylinder', 'flat_plate', 'disc', 'bookmark', 'pin',
      'custom_keychain', 'mug', 'imported', 'composite', 'freeform', 'flexified',
    ]) {
      expect(iterationStrategies).toContain(k)
    }
  })
  it('maps an imported design to "imported", not "generative"', () => {
    expect(designKindToStrategy('imported')).toBe('imported')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/strategy-kind.test.ts` — Expected: FAIL with `Cannot find module '@/db/strategy'`.
- [ ] **Step 3: Implement** — create the strategy list/mapper and reference it from the schema enum:

```ts
// src/db/strategy.ts
// Real iteration "kind" written to iterations.strategy. Supersedes the legacy
// ['parametric','generative'] pair, which carried no information (all rows were
// hardcoded 'generative'). 'parametric'/'generative' kept for back-compat on
// existing rows; new writes use the design.kind below.
export const iterationStrategies = [
  'parametric', 'generative',
  'hollow_cylinder', 'flat_plate', 'disc', 'bookmark', 'pin',
  'custom_keychain', 'mug', 'imported', 'composite', 'freeform', 'flexified',
] as const
export type IterationStrategy = (typeof iterationStrategies)[number]

export function designKindToStrategy(kind: string): IterationStrategy {
  return (iterationStrategies as readonly string[]).includes(kind)
    ? (kind as IterationStrategy)
    : 'generative'
}
```

In `src/db/schema.ts:64-66` swap the inline literal array for the shared list:
```ts
import { iterationStrategies } from './strategy'
// ...
  strategy: text('strategy', { enum: iterationStrategies })
    .notNull()
    .default('parametric'),
```

In `generate/route.ts`: the up-front insert at `:103-112` doesn't yet know `design.kind`, so keep it `'generative'` there but set the real kind on the success update at `:344-350`: add `strategy: designKindToStrategy(design.kind),` to the `.set({...})`. In `flexify/route.ts` set `strategy: 'flexified'` on the success update at `:163-169` (the `:135` insert can stay `'generative'` pre-result). Drop the now-meaningless `strategy: 'generative'` from the two `Response.json` bodies (`generate:356`, `flexify:175`) only if no client reads it — `Chat.tsx`/`ProjectWorkspace.tsx` derive their own badge per Phase 3, so leaving the response field is harmless; do NOT remove it here to avoid a response-shape change outside this task's scope.

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/strategy-kind.test.ts` — Expected: PASS. `npx tsc --noEmit` — Expected: 0.
- [ ] **Step 5: Commit** — `git add src/db/strategy.ts src/db/schema.ts src/app/api/generate/route.ts src/app/api/flexify/route.ts tests/unit/strategy-kind.test.ts` then `git commit -m "fix(db): write real design kind to iterations.strategy (was always 'generative')"` (trailer).

---

### Task 5.3: Add indexes, FK, enum CHECKs, timestamptz, and drop `parent_iteration_id` in the schema (structural)

Encode all schema-level changes in `src/db/schema.ts` so `db:generate` emits one migration. Findings: no index on `iterations(project_id, created_at)` or `projects(user_id)`; no FK on `projects.current_iteration_id` (line 51); dead `parent_iteration_id` (line 59); no CHECK on text enums (`status`/`strategy`/`base_mode`); `timestamp` columns are tz-naive. The destructive bits (drop column, FK) land in 5.4's generated SQL — this task is the schema edit only, but it's (structural) because it changes the table contract.

**Files:**
- Modify: `src/db/schema.ts:1` (imports: add `index`, `check`, `sql`), `:47-76` (projects + iterations table defs)

- [ ] **Step 1: Verification setup (no unit test — schema shape is verified by the generated SQL in 5.4).** Confirm zero existing FK violations before adding the FK, so the migration tolerates the 90 live projects:
  `psql "$DATABASE_URL" -c "SELECT count(*) FROM projects p WHERE p.current_iteration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM iterations i WHERE i.id = p.current_iteration_id);"`
  — Expected: `0`.

- [ ] **Step 2: (skip — covered by Step 1 probe + 5.4 replay).**

- [ ] **Step 3: Implement the schema edits.** Update the imports on `schema.ts:1`:
```ts
import { pgTable, text, timestamp, uuid, jsonb, primaryKey, integer, index, check, foreignKey } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
```
**Declaration order is MANDATORY: move the `iterations` table ABOVE `projects` in the file.** `projects`'s `foreignKey({ foreignColumns: [iterations.id] })` is evaluated synchronously when `pgTable('projects', …)` runs, so `iterations` must already be defined or module load throws a TDZ `ReferenceError`. (`iterations`'s own `.references(() => projects.id)` is a lazy thunk, so it tolerates `projects` being defined later — only the direct `[iterations.id]` array reference is eager.) Keep `iterationsRelations`/`projectsRelations` at the bottom.

Rewrite `projects` to add the FK to `iterations` and the `user_id` index. Because `iterations` references `projects` and `projects.current_iteration_id` references `iterations`, declare the FK in the table callback (avoids a circular `.references()` at column level):
```ts
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  currentIterationId: uuid('current_iteration_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdIdx: index('projects_user_id_idx').on(t.userId),
  currentIterationFk: foreignKey({
    columns: [t.currentIterationId],
    foreignColumns: [iterations.id],
    name: 'projects_current_iteration_id_iterations_id_fk',
  }).onDelete('set null'),
}))
```
Rewrite `iterations` (`:56-76`): drop `parentIterationId` (line 59) entirely, switch the four timestamp columns (`slicedAt`, `createdAt`; `slicedAt` was tz-naive too) to `withTimezone: true`, and add the composite index + CHECK constraints in the callback. The `enum:` option already constrains Drizzle types; add explicit DB CHECKs so the DB enforces them too:
```ts
export const iterations = pgTable('iterations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userMessage: text('user_message').notNull(),
  imageBlobUrl: text('image_blob_url'),
  jscadCode: text('jscad_code'),
  validationReport: jsonb('validation_report'),
  strategy: text('strategy', { enum: iterationStrategies }).notNull().default('parametric'),
  meshBlobUrl: text('mesh_blob_url'),
  status: text('status', { enum: ['generating', 'ready', 'failed', 'sliced'] }).notNull(),
  error: text('error'),
  slicedBlobUrl: text('sliced_blob_url'),
  slicedMeta: jsonb('sliced_meta'),
  slicedAt: timestamp('sliced_at', { withTimezone: true }),
  baseMode: text('base_mode', { enum: ['mesh_only', 'with_base'] }),
  imageDescription: text('image_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectCreatedIdx: index('iterations_project_id_created_at_idx').on(t.projectId, t.createdAt),
  statusCheck: check('iterations_status_check', sql`${t.status} IN ('generating','ready','failed','sliced')`),
  baseModeCheck: check('iterations_base_mode_check', sql`${t.baseMode} IS NULL OR ${t.baseMode} IN ('mesh_only','with_base')`),
  strategyCheck: check('iterations_strategy_check', sql`${t.strategy} IN (${sql.join(iterationStrategies.map((s) => sql`${s}`), sql`, `)})`),
}))
```
Note: keep the `users.createdAt`/`sessions.expires`/`verificationTokens.expires`/`accounts` columns as-is — they're NextAuth-adapter-managed (changing them risks the adapter); the findings target the app's own `projects`/`iterations` timestamps. Decide explicitly and note it in the commit body.

- [ ] **Step 4: Type-check + load-smoke** — `npx tsc --noEmit` — Expected: 0 errors. Step 3's mandatory `iterations`-before-`projects` ordering prevents the TDZ that the synchronous `foreignColumns: [iterations.id]` would otherwise throw on module load; sanity-check the module actually loads with `pnpm dlx tsx -e "import('@/db/schema').then(()=>console.log('schema ok'))"` — Expected: `schema ok` (catches the TDZ that tsc alone won't).
- [ ] **Step 5: Commit** — `git add src/db/schema.ts` then `git commit -m "feat(db): indexes, current_iteration FK, enum CHECKs, timestamptz; drop dead parent_iteration_id"` (trailer). (Commit the schema edit separately from the generated SQL so the destructive migration is its own reviewable checkpoint in 5.4.)

---

### Task 5.4: Generate + sanity-review the migration, then replay on a genuinely fresh DB (destructive)

`db:generate` emits the SQL from 5.3. The drop of `parent_iteration_id` is irreversible (destructive). Verify it replays clean on a dropped+recreated DB (not a reused Docker volume), per the spec's explicit warning.

**Files:**
- Create: `drizzle/0005_*.sql` (generated) + `drizzle/meta/0005_snapshot.json`, `_journal.json` update (all generated by drizzle-kit)

- [ ] **Step 1: Generate the migration** — `pnpm db:generate` — Expected: a new `drizzle/0005_*.sql`. Read it and confirm it contains: `CREATE INDEX "iterations_project_id_created_at_idx"`, `CREATE INDEX "projects_user_id_idx"`, `ALTER TABLE "projects" ADD CONSTRAINT "projects_current_iteration_id_iterations_id_fk" ... ON DELETE set null`, `ALTER TABLE "iterations" DROP COLUMN "parent_iteration_id"`, the three `ADD CONSTRAINT ... CHECK`, and `ALTER COLUMN ... SET DATA TYPE timestamp with time zone` for `projects.created_at/updated_at` + `iterations.sliced_at/created_at`. If drizzle-kit interactively asks whether the dropped column is a rename, answer that it is a **drop** (it is never written — verified: no insert sets `parentIterationId`).

- [ ] **Step 2: Guard the FK against live data** — before replay, confirm the production-shaped data has 0 violations (re-run the 5.3 Step-1 probe against the live DB). Expected: `0`. (The FK `ADD CONSTRAINT` would otherwise fail on the 90-project DB.)

- [ ] **Step 3: Fresh-DB replay** — drop and recreate the Docker Postgres so no reused volume hides a partially-applied state, then migrate from zero:
```bash
docker exec 3dgen-postgres psql -U postgres -c "DROP DATABASE IF EXISTS threedgen_fresh;" \
  && docker exec 3dgen-postgres psql -U postgres -c "CREATE DATABASE threedgen_fresh;" \
  && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/threedgen_fresh" pnpm db:migrate
```
(Adjust the connection string/creds to the local `.env.local` `DATABASE_URL`.) Expected: drizzle-kit applies `0000`→`0005` with no error and prints the final migration as applied.

- [ ] **Step 4: Confirm the resulting schema** — against the fresh DB:
```bash
docker exec 3dgen-postgres psql -U postgres -d threedgen_fresh -c "\d+ iterations" \
  && docker exec 3dgen-postgres psql -U postgres -d threedgen_fresh -c "\d+ projects"
```
Expected: `parent_iteration_id` absent; indexes `iterations_project_id_created_at_idx` + `projects_user_id_idx` present; FK `projects_current_iteration_id_iterations_id_fk` with `ON DELETE SET NULL`; three CHECK constraints; the four timestamp columns shown as `timestamp with time zone`. Drop the scratch DB after: `docker exec 3dgen-postgres psql -U postgres -c "DROP DATABASE threedgen_fresh;"`.

- [ ] **Step 5: Commit** — `git add drizzle/0005_*.sql drizzle/meta/` then `git commit -m "feat(db): migration 0005 — indexes, FK, CHECKs, timestamptz, drop parent_iteration_id"` (trailer). Mark in the body that this is the destructive checkpoint (column drop) and that it replayed clean on a fresh DB.

---

### Task 5.5: Backfill the 2 unrenderable legacy `ready` rows to `failed`

The audit found 13 legacy `status='ready'` rows with NULL `mesh_blob_url`; of these, 2 are generative-with-no-mesh-and-no-jscad (genuinely unrenderable) and should be `failed`. Data-only; gate on a SELECT first so we touch exactly those 2.

**Files:**
- Create: `scripts/backfill-unrenderable-ready.ts`

- [ ] **Step 1: Dry-run SELECT (gate before any write).** The unrenderable predicate: `status='ready' AND mesh_blob_url IS NULL AND jscad_code IS NULL`. Run it first:
```bash
docker exec 3dgen-postgres psql -U postgres -d <devdb> -c \
  "SELECT id, project_id, created_at FROM iterations WHERE status='ready' AND mesh_blob_url IS NULL AND jscad_code IS NULL;"
```
Expected: exactly the 2 rows (not 13 — the other 11 have `jscad_code` and re-render via Chat). If the count is not 2, STOP and reconcile against the audit before proceeding (this is a (destructive)-adjacent data write — confirm scope).

- [ ] **Step 2: (no unit test — one-off data script; the Step-1 count is the gate).**

- [ ] **Step 3: Implement the idempotent backfill script** (dry-run by default; `--apply` to write):
```ts
// scripts/backfill-unrenderable-ready.ts
import { db } from '@/db'
import { iterations } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

async function main() {
  const apply = process.argv.includes('--apply')
  const where = and(
    eq(iterations.status, 'ready'),
    isNull(iterations.meshBlobUrl),
    isNull(iterations.jscadCode),
  )
  const targets = await db.select({ id: iterations.id }).from(iterations).where(where)
  console.log(`[backfill] ${targets.length} unrenderable 'ready' rows`, targets.map((t) => t.id))
  if (!apply) {
    console.log("[backfill] dry-run — pass --apply to set them to 'failed'")
    return
  }
  await db.update(iterations)
    .set({ status: 'failed', error: 'backfill: ready row had neither mesh nor jscad (unrenderable)' })
    .where(where)
  console.log(`[backfill] updated ${targets.length} rows to 'failed'`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run dry-run, then apply** — `pnpm dlx tsx scripts/backfill-unrenderable-ready.ts` (dry-run; Expected: lists the 2 ids) then `pnpm dlx tsx scripts/backfill-unrenderable-ready.ts --apply` (Expected: `updated 2 rows`). Re-run the Step-1 SELECT — Expected: `0` rows (idempotent).

- [ ] **Step 5: Commit** — `git add scripts/backfill-unrenderable-ready.ts` then `git commit -m "chore(data): backfill 2 unrenderable 'ready' iterations to 'failed'"` (trailer). (Script is committed for reproducibility/audit trail; the data write itself is not in git.)

---

### Task 5.6: Add the `del()` blob helper wired into the persist module (structural)

Findings: blobs are write-only, no deletion story. **This task CREATES `src/lib/storage/persist.ts`** (Phase 5 runs before Phase 6, so the file does not exist yet) with a `delMesh()` helper that deletes a mesh URL (Vercel blob via `del()` from `@vercel/blob`, or unlinks the local `public/meshes` file). Task 6.1 later ADDS `persistMesh` to this same file. No user-facing UI — `delMesh` is the primitive the orphan-sweep (5.7) and any future delete flow use. (structural: new exported helper in a shared module.)

**Files:**
- Create: `src/lib/storage/persist.ts` (with `delMesh`; Task 6.1 adds `persistMesh` to the same file)
- Test: `tests/unit/persist-del.test.ts`

- [ ] **Step 1: Write the failing test** — local-file branch unlinks the right path; blob branch calls `del()`. Mock `@vercel/blob` and `node:fs/promises`.

```ts
// tests/unit/persist-del.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const del = vi.fn(async () => {})
const unlink = vi.fn(async () => {})
vi.mock('@vercel/blob', () => ({ del }))
vi.mock('node:fs/promises', async (orig) => ({ ...(await orig<typeof import('node:fs/promises')>()), unlink }))

import { delMesh } from '@/lib/storage/persist'

describe('delMesh', () => {
  beforeEach(() => { del.mockClear(); unlink.mockClear() })

  it('unlinks a local /meshes path', async () => {
    await delMesh('/meshes/abc.stl')
    expect(unlink).toHaveBeenCalledTimes(1)
    expect(unlink.mock.calls[0][0]).toContain('public/meshes/abc.stl')
    expect(del).not.toHaveBeenCalled()
  })

  it('calls @vercel/blob del() for an http blob url', async () => {
    await delMesh('https://blob.example.com/u/p/i.3mf')
    expect(del).toHaveBeenCalledWith('https://blob.example.com/u/p/i.3mf', expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/persist-del.test.ts` — Expected: FAIL (`delMesh` not exported from `persist.ts`).

- [ ] **Step 3: Create `src/lib/storage/persist.ts` with `delMesh`** (Task 6.1 later adds `persistMesh` here — keep the imports it adds in mind, but `delMesh`'s imports stand alone for now):
```ts
import { del } from '@vercel/blob'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '@/env'

/** Delete a persisted mesh. http(s) → Vercel blob; '/meshes/...' → local file.
 *  Swallows "already gone" so the orphan-sweep stays idempotent. */
export async function delMesh(meshUrl: string): Promise<void> {
  if (meshUrl.startsWith('http')) {
    await del(meshUrl, { token: env.BLOB_READ_WRITE_TOKEN })
    return
  }
  if (meshUrl.startsWith('/meshes/')) {
    const abs = join(process.cwd(), 'public', meshUrl.replace(/^\//, ''))
    await unlink(abs).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/persist-del.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/storage/persist.ts tests/unit/persist-del.test.ts` then `git commit -m "feat(storage): delMesh() blob/local delete helper"` (trailer).

---

### Task 5.7: Orphan-mesh sweep script (dry-run default, reports only)

Findings: 194 orphan files (33MB) in `public/meshes` with no matching `iterations.mesh_blob_url`. Add `scripts/sweep-orphan-meshes.ts` that lists local mesh files lacking a DB referent and reports them; `--apply` deletes via `delMesh()` (5.6). No UI.

**Files:**
- Create: `scripts/sweep-orphan-meshes.ts`
- Test: `tests/unit/sweep-orphan.test.ts`

- [ ] **Step 1: Write the failing test** — extract the pure set-diff (`findOrphans(diskBasenames, referencedUrls)`) and test it; the disk/DB I/O stays in `main()`.

```ts
// tests/unit/sweep-orphan.test.ts
import { describe, it, expect } from 'vitest'
import { findOrphans } from '@/../scripts/sweep-orphan-meshes'

describe('findOrphans', () => {
  it('flags disk files not referenced by any iteration mesh url', () => {
    const disk = ['a.stl', 'b.3mf', 'c.stl']
    const referenced = ['/meshes/a.stl', 'https://blob.example.com/x/y/b.3mf']
    expect(findOrphans(disk, referenced)).toEqual(['c.stl'])
  })
  it('matches blob urls by trailing basename', () => {
    expect(findOrphans(['i.3mf'], ['https://blob.example.com/u/p/i.3mf'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/sweep-orphan.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the script** with the exported pure helper:
```ts
// scripts/sweep-orphan-meshes.ts
import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { db } from '@/db'
import { iterations } from '@/db/schema'
import { isNotNull } from 'drizzle-orm'
import { delMesh } from '@/lib/storage/persist'

/** Disk basenames with no iteration row pointing at them (by trailing basename). */
export function findOrphans(diskBasenames: string[], referencedUrls: string[]): string[] {
  const ref = new Set(referencedUrls.map((u) => basename(u)))
  return diskBasenames.filter((f) => !ref.has(f))
}

async function main() {
  const apply = process.argv.includes('--apply')
  const dir = join(process.cwd(), 'public', 'meshes')
  const disk = await readdir(dir).catch(() => [] as string[])
  const rows = await db
    .select({ url: iterations.meshBlobUrl })
    .from(iterations)
    .where(isNotNull(iterations.meshBlobUrl))
  const orphans = findOrphans(disk, rows.map((r) => r.url!).filter(Boolean))
  console.log(`[sweep] ${disk.length} files on disk, ${rows.length} referenced, ${orphans.length} orphans`)
  for (const f of orphans) console.log('  orphan:', f)
  if (!apply) {
    console.log('[sweep] dry-run — pass --apply to delete the orphans')
    return
  }
  for (const f of orphans) await delMesh(`/meshes/${f}`)
  console.log(`[sweep] deleted ${orphans.length} orphan files`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```
(Local-only sweep — production blobs would need a `@vercel/blob` `list()` pass; out of scope per "no UI / data hygiene". Note that in the script header.)

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/sweep-orphan.test.ts` — Expected: PASS. Then run the dry-run against dev: `pnpm dlx tsx scripts/sweep-orphan-meshes.ts` — Expected: prints the orphan count (the audited ~194) and `dry-run` notice; makes no writes.
- [ ] **Step 5: Commit** — `git add scripts/sweep-orphan-meshes.ts tests/unit/sweep-orphan.test.ts` then `git commit -m "feat(scripts): orphan-mesh sweep (dry-run default)"` (trailer).

---

### Task 5.8: EXPLAIN-verify index usage on the hot filters

Closes the spec acceptance: `EXPLAIN` shows index use on the `project_id`/`user_id` filters after 0005.

**Files:** none (verification only).

- [ ] **Step 1: EXPLAIN the project-list filter** (the `projects` page's `eq(projects.userId, …)` and the history `eq(iterations.projectId, …) ORDER BY created_at`):
```bash
docker exec 3dgen-postgres psql -U postgres -d <devdb> -c \
  "EXPLAIN SELECT * FROM projects WHERE user_id = (SELECT id FROM users LIMIT 1);"
docker exec 3dgen-postgres psql -U postgres -d <devdb> -c \
  "EXPLAIN SELECT * FROM iterations WHERE project_id = (SELECT id FROM projects LIMIT 1) ORDER BY created_at ASC;"
```
- [ ] **Step 2:** Expected: the plans reference `Index Scan using projects_user_id_idx` and `Index Scan using iterations_project_id_created_at_idx` (on a near-empty dev DB Postgres may still pick a seq scan — if so, force the planner with `SET enable_seqscan = off;` before the EXPLAIN to confirm the index is *usable*, and note the planner will switch as the table grows).
- [ ] **Step 3–5:** No code change, no commit. Record the EXPLAIN output in the final phase report.

---

I now have everything grounded. The persist helper must be testable without a real blob token (the local-write branch is reachable in tests since `BLOB_READ_WRITE_TOKEN` is unset in the test env). I have all 4 call sites, both duplicated helpers, the god-function structure, the dead module's full export surface, the headswap CLI-only confirmation, and the validation_report read/write sites.

I'm ready to write the Phase 6 plan.

## Phase 6 — Architecture consolidation

Phase goal: collapse the duplicated persistence/geometry helpers into single sources of truth, retire dead code, and lock the `validation_report` cache shape behind a zod schema — all behavior-preserving, with tsc and the full vitest suite staying green.

---

### Task 6.1: Add the shared `persistMesh` helper to the persist module [structural]

`src/lib/storage/persist.ts` already exists (created in Task 5.6 with `delMesh`). This task ADDS `persistMesh` to it and migrates the 4 call sites. Merge imports — `join` and `env` are likely already imported by `delMesh`; add only what `persistMesh` needs (`put` from `@vercel/blob`, `writeFile`/`mkdir`, etc.) without duplicating.

**Files:**
- Modify: `src/lib/storage/persist.ts` (add `persistMesh` alongside the existing `delMesh`)
- Test: `tests/unit/persist.test.ts`

The 4 current call sites diverge: `generate/route.ts:370-391` detects `.3mf`/`.stl` by magic bytes (`0x50 0x4b` = ZIP/3MF) and picks `model/stl` vs `application/octet-stream`; `flexify/route.ts:183-201` is hard-coded to `.3mf`; `slice/route.ts:69-75` writes only when blob is configured (no local fallback) under a caller-built filename; `upload/route.ts:48-60` uses a `{userId}/uploads/{id}.{ext}` key with caller-chosen ext + contentType. The common shape across generate + flexify is `(bytes, userId, projectId, iterationId) → url` with magic-byte ext detection. This phase extracts exactly that signature (covers generate + flexify; slice/upload keep their bespoke key layouts and are out of scope to avoid changing their key shapes / response semantics).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/persist.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { persistMesh } from '@/lib/storage/persist'

// No BLOB_READ_WRITE_TOKEN in the test env → exercises the local-write branch.
const written: string[] = []
afterEach(async () => {
  for (const f of written) await rm(f, { force: true })
  written.length = 0
})

describe('persistMesh (local fallback)', () => {
  it('writes a binary STL as .stl and returns the public path', async () => {
    const stl = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    const url = await persistMesh(stl, 'u1', 'p1', 'iter-stl')
    expect(url).toBe('/meshes/iter-stl.stl')
    const onDisk = join(process.cwd(), 'public', 'meshes', 'iter-stl.stl')
    written.push(onDisk)
    expect(new Uint8Array(await readFile(onDisk))).toEqual(stl)
  })

  it('detects a 3MF (PK zip magic) and writes .3mf', async () => {
    const tmf = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const url = await persistMesh(tmf, 'u1', 'p1', 'iter-3mf')
    expect(url).toBe('/meshes/iter-3mf.3mf')
    written.push(join(process.cwd(), 'public', 'meshes', 'iter-3mf.3mf'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/persist.test.ts` — Expected: FAIL — cannot resolve `@/lib/storage/persist` (module does not exist yet).

- [ ] **Step 3: Implement** — add `persistMesh` to the existing `src/lib/storage/persist.ts` (created in 5.6), lifting the generate-route body verbatim (it is the superset — it does the magic-byte ext detection flexify lacks; a 3MF input still serialises identically). Merge imports with `delMesh`'s, don't duplicate `join`/`env`:

```ts
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Persist a generated mesh and return a URL the viewer/slicer can load.
 *
 * Blob-or-local: writes to Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
 * else to public/meshes/ for local dev. The extension + content-type are
 * derived from the bytes (3MF is a ZIP — `PK\x03\x04` magic — everything
 * else is treated as binary STL), so a single call site handles both the
 * parametric .stl and the multi-body .3mf path.
 *
 * Key layout: `${userId}/${projectId}/${iterationId}.${ext}` (Blob) or
 * `/meshes/${iterationId}.${ext}` (local).
 */
export async function persistMesh(
  bytes: Uint8Array,
  userId: string,
  projectId: string,
  iterationId: string,
): Promise<string> {
  const is3mf = bytes[0] === 0x50 && bytes[1] === 0x4b
  const ext = is3mf ? '3mf' : 'stl'
  const contentType = is3mf ? 'application/octet-stream' : 'model/stl'
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${userId}/${projectId}/${iterationId}.${ext}`, Buffer.from(bytes), {
      access: 'public',
      addRandomSuffix: false,
      contentType,
    })
    return blob.url
  }
  const dir = join(process.cwd(), 'public', 'meshes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${iterationId}.${ext}`), Buffer.from(bytes))
  return `/meshes/${iterationId}.${ext}`
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/persist.test.ts` — Expected: PASS (both cases).

- [ ] **Step 5: Commit** — `git add src/lib/storage/persist.ts tests/unit/persist.test.ts` then `git commit -m "feat(storage): extract shared persistMesh blob-or-local helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.2: Replace the generate-route persist call site [structural]

**Files:**
- Modify: `src/app/api/generate/route.ts:25` (imports), `:335` (call), `:370-391` (remove local fn)

The local `persistMesh` at `generate/route.ts:370-391` is byte-identical to the new helper. Removing it also drops the now-unused `put`, `mkdir`, `writeFile`, `join` imports IF no other code in the file uses them — but `readFile`/`join` are still used at `:136` (`readFile(join(process.cwd(), 'public', effectiveImageUrl))`), so keep `join`/`readFile`, drop only `put`, `mkdir`, `writeFile`.

- [ ] **Step 1: Verify the other consumers of the node:fs imports** — `grep -n "put(\|mkdir(\|writeFile(\|readFile(\|join(" src/app/api/generate/route.ts` — Expected: after removing the local fn, only `readFile(` (line ~136) and `join(` (line ~136) remain; `put`/`mkdir`/`writeFile` appear zero times.

- [ ] **Step 2: Implement** — add the import (after line 26 `serialize3mf` import):

```ts
import { persistMesh } from '@/lib/storage/persist'
```

Adjust the existing imports at `:25` and `:29` — remove the `@vercel/blob` `put` import (line 25) and narrow the `node:fs/promises` import (line 29) from `{ mkdir, readFile, writeFile }` to `{ readFile }`:

```ts
// line 25: DELETE  import { put } from '@vercel/blob'
// line 29: was  import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
```

Then delete the entire local `async function persistMesh(...) { ... }` block at `:370-391`. The call at `:335` (`const meshUrl = await persistMesh(finalMeshBytes, session.user.id, projectId, iteration.id)`) stays unchanged — it now resolves to the import.

- [ ] **Step 3: Verify the build** — `npx tsc --noEmit` — Expected: 0 errors (no unused-import or missing-symbol errors).

- [ ] **Step 4: Run the route's tests** — `pnpm test` — Expected: PASS — full suite green, no regression (generate route has no direct unit test; tsc + suite is the guard).

- [ ] **Step 5: Commit** — `git add src/app/api/generate/route.ts` then `git commit -m "refactor(generate): use shared persistMesh helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.3: Replace the flexify-route persist call site [structural]

**Files:**
- Modify: `src/app/api/flexify/route.ts:19` (import), `:21` (node:fs imports), `:161` (call unchanged), `:183-201` (remove local fn)

flexify's local `persistMesh` (`:183-201`) hard-codes `.3mf`. flexify only ever feeds it `result.bytes` from `flexify()`, which is always a multi-body 3MF (`serialize3mf` output, ZIP magic `PK`), so the shared helper's magic-byte detection yields the same `.3mf` ext + `application/octet-stream` content-type — behavior-identical. `flexify/route.ts:21` imports `{ mkdir, readFile, realpath, stat, writeFile }` from `node:fs/promises`; `readFile`/`realpath`/`stat` are still used by `readMeshBytes` (`:46-82`), so drop only `mkdir` and `writeFile`. `put` (`:19`) becomes unused — drop it.

- [ ] **Step 1: Verify the remaining node:fs consumers** — `grep -n "put(\|mkdir(\|writeFile(\|realpath(\|stat(\|readFile(" src/app/api/flexify/route.ts` — Expected: after removing the local fn, `realpath(`, `stat(`, `readFile(` remain (in `readMeshBytes`); `put`/`mkdir`/`writeFile` appear zero times.

- [ ] **Step 2: Implement** — replace the `put` import (`:19`) and narrow the `node:fs/promises` import (`:21`), add the shared import:

```ts
// line 19: DELETE  import { put } from '@vercel/blob'
// line 21: was  import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { readFile, realpath, stat } from 'node:fs/promises'
import { persistMesh } from '@/lib/storage/persist'
```

Delete the local `async function persistMesh(...) { ... }` block at `:183-201`. The call at `:161` (`const meshUrlOut = await persistMesh(bytes, session.user.id, projectId, iteration.id)`) stays — now resolves to the import.

- [ ] **Step 3: Verify the build** — `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 4: Run the suite** — `pnpm test` — Expected: PASS — full suite green.

- [ ] **Step 5: Commit** — `git add src/app/api/flexify/route.ts` then `git commit -m "refactor(flexify): use shared persistMesh helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.4: Move `makeFrame`/`orientAlongNormal` into `ops/_shared.ts` [structural]

**Files:**
- Modify: `src/lib/import/ops/_shared.ts` (add two exports)
- Modify: `src/lib/import/ops/add-logo.ts:175-224` (remove locals, import), `src/lib/import/ops/hole.ts:42,58-113` (remove locals, import)
- Test: `tests/unit/ops-frame.test.ts`

`makeFrame` is byte-identical in `add-logo.ts:175-191` and `hole.ts:58-74`. `orientAlongNormal` is identical logic in `add-logo.ts:195-224` and `hole.ts:78-113` (hole's copy carries extra explanatory comments but the same branches). Both take a `Transforms` param so `_shared.ts` need not itself import `@jscad/modeling` at module scope — the type alias `typeof import('@jscad/modeling').transforms` is type-only.

- [ ] **Step 1: Write the failing test** (pin the contract being centralized — orthonormal frame + Z-aligned identity):

```ts
// tests/unit/ops-frame.test.ts
import { describe, it, expect } from 'vitest'
import { makeFrame, orientAlongNormal } from '@/lib/import/ops/_shared'
import * as jscad from '@jscad/modeling'

const transforms = (jscad as { default?: typeof jscad }).default?.transforms ?? jscad.transforms

describe('makeFrame', () => {
  it('returns a tangent + bitangent orthogonal to the normal and to each other', () => {
    const n: [number, number, number] = [0, 0, 1]
    const { tangent, bitangent } = makeFrame(n)
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(Math.abs(dot(tangent, n))).toBeLessThan(1e-9)
    expect(Math.abs(dot(bitangent, n))).toBeLessThan(1e-9)
    expect(Math.abs(dot(tangent, bitangent))).toBeLessThan(1e-9)
  })
})

describe('orientAlongNormal', () => {
  it('is identity when the normal already points +Z', () => {
    const cube = (jscad as { default?: typeof jscad }).default?.primitives ?? jscad.primitives
    const geom = cube.cuboid({ size: [2, 2, 2] })
    const out = orientAlongNormal(geom as never, [0, 0, 1], transforms)
    expect(out).toBe(geom) // dot > 0.9999 short-circuit returns the input
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/ops-frame.test.ts` — Expected: FAIL — `makeFrame`/`orientAlongNormal` are not exported from `@/lib/import/ops/_shared`.

- [ ] **Step 3: Implement** — append to `src/lib/import/ops/_shared.ts` (after `geom3ToBaseMesh`), copying the bodies verbatim from `add-logo.ts` (the cleaner copy):

```ts
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'

type Transforms = typeof import('@jscad/modeling').transforms

/** Build an orthonormal in-plane frame (tangent, bitangent) for a unit normal.
 *  Used to place geometry at a face centroid + (u,v) in-plane offset. */
export function makeFrame(normal: [number, number, number]) {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const tx = seed[0] - dot * normal[0]
  const ty = seed[1] - dot * normal[1]
  const tz = seed[2] - dot * normal[2]
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  const tangent: [number, number, number] = [tx / tl, ty / tl, tz / tl]
  const bitangent: [number, number, number] = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ]
  return { tangent, bitangent }
}

/** Rotate a geom built along +Z so its axis aligns with `normal`. */
export function orientAlongNormal(
  geom: Geom3,
  normal: [number, number, number],
  transforms: Transforms,
): Geom3 {
  const dot = Math.max(-1, Math.min(1, normal[2])) // Z · normal = nz
  if (dot > 0.9999) return geom
  if (dot < -0.9999) return transforms.rotateX(Math.PI, geom) as Geom3
  const angle = Math.acos(dot)
  const axisX = -normal[1]
  const axisY = normal[0]
  const alen = Math.sqrt(axisX * axisX + axisY * axisY) || 1
  const naxisX = axisX / alen
  const naxisY = axisY / alen
  if (Math.abs(naxisY) >= Math.abs(naxisX)) {
    return transforms.rotateY(angle * Math.sign(naxisY), geom) as Geom3
  } else {
    return transforms.rotateX(angle * Math.sign(naxisX), geom) as Geom3
  }
}
```

Then in `add-logo.ts`: extend the existing import at `:5` to pull the two helpers, and delete the local `makeFrame` (`:175-191`) and `orientAlongNormal` (`:195-224`) plus the now-unused `type Transforms` alias (`:193`):

```ts
// add-logo.ts:5 — was: import { geom3ToBaseMesh, recomputeMeshDerived } from './_shared'
import { geom3ToBaseMesh, makeFrame, orientAlongNormal, recomputeMeshDerived } from './_shared'
```

In `hole.ts`: extend the import at `:3` and delete the local `makeFrame` (`:58-74`), `orientAlongNormal` (`:78-113`), and the `type Transforms` alias (`:76`):

```ts
// hole.ts:3 — was: import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'
import { baseMeshToGeom3, geom3ToBaseMesh, makeFrame, orientAlongNormal } from './_shared'
```

The call sites in both files (`add-logo.ts:99,102`; `hole.ts:39,42`) are unchanged — `orientAlongNormal(geom, normal, transforms)` / `makeFrame(normal)` resolve to the imports.

- [ ] **Step 4: Run tests + build** — `pnpm test tests/unit/ops-frame.test.ts` (Expected: PASS) then `npx tsc --noEmit` (Expected: 0 errors — no unused `Transforms` alias or `Geom3` import left dangling).

- [ ] **Step 5: Commit** — `git add src/lib/import/ops/_shared.ts src/lib/import/ops/add-logo.ts src/lib/import/ops/hole.ts tests/unit/ops-frame.test.ts` then `git commit -m "refactor(ops): hoist makeFrame/orientAlongNormal into _shared

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.5: Export `loadJscad` and adopt it in hole/emboss-text/jscad-raw [structural]

**Files:**
- Modify: `src/lib/import/ops/_shared.ts:45` (export `loadJscad`)
- Modify: `src/lib/import/ops/hole.ts:3,16`, `src/lib/import/ops/emboss-text.ts:3,28-35`, `src/lib/import/ops/jscad-raw.ts:18,30`

`loadJscad` already exists at `_shared.ts:45` but is `async function loadJscad()` (not exported). The three ops use a bare `await import('@jscad/modeling')` then destructure — which under CJS↔ESM interop hits the `{ default }` shape `loadJscad` was written to normalize. Finding 5 is cosmetic (refuted as a crash), so this is a consistency change, not a fix; behavior is unchanged because the modules currently happen to resolve correctly in the test/build runtime. Pure consistency — no new test (the existing op tests are the regression guard).

- [ ] **Step 1: Export the helper** — `src/lib/import/ops/_shared.ts:45`, change the declaration:

```ts
// was: async function loadJscad() {
/** Resolve @jscad/modeling regardless of CJS-vs-ESM default-export shape.
 *  Mirrors the workaround in src/lib/design/generate.ts. */
export async function loadJscad() {
```

- [ ] **Step 2: Adopt in the three ops** —

`hole.ts:3` extend import, `:16` replace the bare import:
```ts
// :3  import { baseMeshToGeom3, geom3ToBaseMesh, makeFrame, loadJscad, orientAlongNormal } from './_shared'
// :16 was: const { primitives, booleans, transforms } = await import('@jscad/modeling')
const { primitives, booleans, transforms } = await loadJscad()
```

`emboss-text.ts:3` extend import, `:28-35` replace:
```ts
// :3  import { baseMeshToGeom3, geom3ToBaseMesh, loadJscad } from './_shared'
// :28-35 was: const { text, extrusions, booleans, transforms, geometries, expansions } = await import('@jscad/modeling')
const { text, extrusions, booleans, transforms, geometries, expansions } = await loadJscad()
```

`jscad-raw.ts:18` extend import, `:30` replace:
```ts
// :18 import { baseMeshToGeom3, geom3ToBaseMesh, loadJscad } from './_shared'
// :30 was: const jscad = await import('@jscad/modeling')
const jscad = await loadJscad()
```

- [ ] **Step 3: Verify the build** — `npx tsc --noEmit` — Expected: 0 errors (`loadJscad`'s inferred return type is the same `@jscad/modeling` namespace these destructures already expect).

- [ ] **Step 4: Run the op tests** — `pnpm test` — Expected: PASS — full suite green (hole/emboss/jscad-raw exercised via the import-ops and design-generate tests; no behavior change).

- [ ] **Step 5: Commit** — `git add src/lib/import/ops/_shared.ts src/lib/import/ops/hole.ts src/lib/import/ops/emboss-text.ts src/lib/import/ops/jscad-raw.ts` then `git commit -m "refactor(ops): use shared loadJscad for CJS/ESM interop consistency

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.6: Split `extrudeLogo` into per-step functions

**Files:**
- Modify: `src/lib/logo-extrude/extrude.ts:157-690`

`extrudeLogo` is a 535-line function whose 9-step header (`:4-16`) already names the seams. Extract pure private helpers within the same module, keeping `extrudeLogo` as the orchestrator with an unchanged signature and return shape (`LogoExtrudeResult`). The extract boundaries follow the existing step comments:
- `preprocessToGrayscale(opts, meta, rect)` — steps 1b–1d (`:191-319`): alpha/colour/luma mask + polarity + trim → `Buffer`.
- `traceToSubpaths(grayscale, opts, turdSize)` — steps 2–3 (`:321-352`): potrace + parse + Y-flip → `Pt[][]`.
- `classifySubpaths(subpaths)` — step 4 (`:354-408`): nesting depth → `{ infos, holesByOuter, outersByHole }`.
- `buildShape2Ds(infos, holesByOuter, outersByHole, opts, …)` — steps 5–6 (`:410-572`): per-outer/per-hole geom2 build → `{ shape2Ds, logo2DGeoms, droppedPieces }`.
- `assembleAndSerialize(shape2Ds, logo2DGeoms, infos, opts, subpaths)` — steps 7–9 (`:574-689`): union, stand, bbox/center/scale, serialize, `meta`/`geom3`/`logo2D*` → the `LogoExtrudeResult`.

This is a pure mechanical refactor — `generateTexturePattern` (`:692-771`) stays as-is. The two existing extrude tests (`tests/unit/logo-extrude-color.test.ts` asserting `meta.outers`; `tests/unit/design-generate.test.ts` which **mocks** `extrudeLogo` so is unaffected) are the regression guard. Keep all six `extrudeLogo` call sites in `generate.ts` and `add-logo.ts:71` working by not touching the public name/shape.

- [ ] **Step 1: Run the existing tests as the green baseline** — `pnpm test tests/unit/logo-extrude-color.test.ts` — Expected: PASS (2 tests: colour-mask + luma path). This is the contract the refactor must preserve; record `meta.outers` is in `[1,3]` for both.

- [ ] **Step 2: Extract the helpers** — within `src/lib/logo-extrude/extrude.ts`, move each step block into a module-private function above `extrudeLogo`, then rewrite `extrudeLogo`'s body to call them in order. Sketch of the new orchestrator body (the helper bodies are the verbatim lifted blocks, threaded by their existing locals):

```ts
export async function extrudeLogo(opts: LogoExtrudeOptions): Promise<LogoExtrudeResult> {
  const cfg = resolveOptions(opts)            // the `?? default` block at :158-169
  const { meta, rect, imgMaxDim } = await measureAndCrop(opts, cfg) // step 1 / 1a (:171-189)
  const grayscale = await preprocessToGrayscale(opts, cfg, meta, rect) // steps 1b-1d (:191-319)
  const subpaths = await traceToSubpaths(grayscale, opts, cfg)         // steps 2-3 (:321-352)
  const { infos, holesByOuter, outersByHole } = classifySubpaths(subpaths) // step 4 (:354-408)
  const { shape2Ds, logo2DGeoms } = buildShape2Ds(                     // steps 5-6 (:410-572)
    infos, holesByOuter, outersByHole, cfg, imgMaxDim,
  )
  return assembleAndSerialize(shape2Ds, logo2DGeoms, infos, subpaths, cfg) // steps 7-9 (:574-689)
}
```

Each helper returns exactly the locals the next step consumes (e.g. `buildShape2Ds` returns the `shape2Ds`/`logo2DGeoms` arrays; `assembleAndSerialize` owns the 2D-bbox/`baseScale2d`/`scaleFactor` precompute at `:422-440` since both step 6 textures and step 8 scaling use it — keep that precompute where its consumers live, passing `cx2d`/`cy2d`/`maxDim2d`/`baseScale2d` through). Do NOT change any numeric constant, sharp pipeline, potrace option, or transform — only relocate.

- [ ] **Step 3: Run the extrude tests to verify behavior is preserved** — `pnpm test tests/unit/logo-extrude-color.test.ts` — Expected: PASS (same 2 tests, `meta.outers` still `[1,3]` for both paths). Then `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 4: Run the full suite** — `pnpm test` — Expected: PASS — including `design-generate.test.ts` (mocked) and any import-ops test exercising `add-logo` → `extrudeLogo`. No count regression vs the spec baseline (175 pass / 1 skip + the new tests from prior tasks).

- [ ] **Step 5: Commit** — `git add src/lib/logo-extrude/extrude.ts` then `git commit -m "refactor(logo-extrude): split extrudeLogo into per-step functions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.7: Add a zod schema for the cached `validation_report` shape [structural]

**Files:**
- Modify: `src/app/api/generate/route.ts:159-167` (imported-mesh read), `:210-215` (previousDesign read), `:339-342` (write)
- Test: `tests/unit/validation-report.test.ts`

`validationReport` is `jsonb` (untyped, `schema.ts:63`). The generate route reads it three ways with unchecked `as` casts: the imported-mesh lookback (`:159-166` casts to `{ kind?; baseMeshUrl?; _faces?; _previews? }`), the `previousDesign` lookback (`:213-215` casts to `Awaited<ReturnType<typeof parseDesign>>`), and the write (`:339-342` builds `Record<string, unknown>`). Define one zod schema for the cached shape (a `Design` optionally annotated with the private `_faces`/`_previews` cache keys) and `safeParse` on read so a malformed/legacy row degrades gracefully instead of feeding garbage downstream. Behavior-preserving: on parse failure the reads fall back to the same `null` they already produce for missing rows.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/validation-report.test.ts
import { describe, it, expect } from 'vitest'
import { CachedDesign, readCachedDesign } from '@/lib/storage/validation-report'

describe('CachedDesign / readCachedDesign', () => {
  it('parses an imported design with cached faces + previews', () => {
    const raw = {
      kind: 'imported',
      baseMeshUrl: 'https://blob/x.3mf',
      edits: [],
      _faces: [{ id: 0, normal: [0, 0, 1], centroid: [0, 0, 0], areaMm2: 1,
        triangleIndices: [0], bboxOnPlane: { min: [0, 0], max: [1, 1] } }],
      _previews: { top: 'd', front: 'd', right: 'd', iso: 'd' },
    }
    const parsed = CachedDesign.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.baseMeshUrl).toBe('https://blob/x.3mf')
      expect(parsed.data._faces?.length).toBe(1)
    }
  })

  it('readCachedDesign returns null for a malformed row instead of throwing', () => {
    expect(readCachedDesign({ kind: 'nonsense', foo: 1 })).toBeNull()
    expect(readCachedDesign(null)).toBeNull()
  })

  it('readCachedDesign returns the typed design for a valid parametric row', () => {
    const d = readCachedDesign({ kind: 'flat_plate', widthMm: 50, heightMm: 40, thicknessMm: 3, cornerRadiusMm: 2 })
    expect(d?.kind).toBe('flat_plate')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/validation-report.test.ts` — Expected: FAIL — `@/lib/storage/validation-report` does not exist.

- [ ] **Step 3: Implement** — create `src/lib/storage/validation-report.ts`. Reuse the existing `Design` discriminatedUnion (`@/lib/design/schema`) so the cached shape can't drift from the real design schema; add the two optional private cache keys as a loose passthrough (faces/previews are plumbing, not user-facing — `z.unknown()` keeps them typed enough for the route's existing casts without re-validating heavy face arrays):

```ts
import { z } from 'zod'
import { Design } from '@/lib/design/schema'
import type { SemanticFace } from '@/lib/import/types'
import type { PreviewBundle } from '@/lib/design/parse-import'

/**
 * The shape stored in iterations.validation_report (jsonb): a built Design,
 * plus — for the imported-mesh flow — the cached semantic faces and 4-angle
 * previews so subsequent iterations skip re-segmentation. Flexify rows store
 * `{ kind: 'flexified', ... }` which is NOT a Design member; readers tolerate
 * a parse miss (returns null) rather than throwing.
 */
export const CachedDesign = Design.and(
  z.object({
    _faces: z.array(z.unknown()).optional(),
    _previews: z.unknown().optional(),
  }),
)

export type CachedDesign = z.infer<typeof CachedDesign> & {
  _faces?: SemanticFace[]
  _previews?: PreviewBundle
}

/** Parse a raw jsonb value into a typed cached design, or null if it isn't one
 *  (legacy row, flexified row, malformed). Never throws. */
export function readCachedDesign(raw: unknown): CachedDesign | null {
  const r = CachedDesign.safeParse(raw)
  return r.success ? (r.data as CachedDesign) : null
}
```

Then in `generate/route.ts`, import it (near the other `@/lib/design` imports, ~`:22`):

```ts
import { CachedDesign, readCachedDesign } from '@/lib/storage/validation-report'
```

Replace the **imported-mesh lookback** (`:157-168`) — keep behavior, drop the bare casts:

```ts
  if (!effectiveMeshUrl) {
    const lastWithMesh = [...history].reverse().find((h) => {
      const vr = readCachedDesign(h.validationReport)
      return vr?.kind === 'imported' && !!vr.baseMeshUrl
    })
    if (lastWithMesh) {
      const vr = readCachedDesign(lastWithMesh.validationReport)
      effectiveMeshUrl = vr?.kind === 'imported' ? vr.baseMeshUrl : null
      cachedFaces = (vr?._faces ?? null) as SemanticFace[] | null
      cachedPreviews = (vr?._previews ?? null) as PreviewBundle | null
    }
  }
```

Replace the **previousDesign lookback** (`:210-215`) — `readCachedDesign` returns the parsed `Design`, which `parseDesign`/`tryQuickModify` consume (the private `_faces`/`_previews` keys are harmless extras already tolerated today):

```ts
  const lastReadyWithDesign = [...history]
    .reverse()
    .find((h) => h.status === 'ready' && h.validationReport)
  const previousDesign = lastReadyWithDesign
    ? readCachedDesign(lastReadyWithDesign.validationReport)
    : null
```

The **write** (`:339-342`) already builds the right shape; leave the runtime object as-is but tighten the type annotation to the schema so future drift is caught:

```ts
  const validationReport: z.infer<typeof CachedDesign> | Record<string, unknown> =
    design.kind === 'imported' && importContext
      ? { ...(design as object), _faces: importContext.faces, _previews: importContext.previewDataUrls }
      : (design as unknown as Record<string, unknown>)
```

(Flexify's write at `flexify/route.ts:167` stores `{ kind: 'flexified', ... }`, which `readCachedDesign` correctly rejects → `null`, matching today's `vr?.kind === 'imported'` guard. No change needed there.)

- [ ] **Step 4: Run tests + build** — `pnpm test tests/unit/validation-report.test.ts` (Expected: PASS, 3 tests) then `npx tsc --noEmit` (Expected: 0 errors — the `previousDesign` type now flows from `readCachedDesign`'s return, assignable to `parseDesign`'s `previousDesign` param). Then `pnpm test` — Expected: PASS — full suite green.

- [ ] **Step 5: Commit** — `git add src/lib/storage/validation-report.ts src/app/api/generate/route.ts tests/unit/validation-report.test.ts` then `git commit -m "refactor(generate): zod-parse the cached validation_report shape

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.8: Mark the head-swap pipeline experimental [structural]

**Files:**
- Modify: `src/lib/flexify/headswap.ts:1-19` (module header)

`headSwap` (`headswap.ts:124`) is reachable ONLY via `src/scripts/headswap-cli.ts:19` — no API route, no UI, no other importer (grep confirmed). Per finding 7, add an explicit experimental marker so a future reader knows it's a CLI-only escape hatch, not a shipped surface. Doc-comment only (no behavior).

- [ ] **Step 1: Add the marker** — prepend to the module header at `headswap.ts:1`, just under the opening `/**`:

```ts
/**
 * Head-swap pipeline — alternate flexify path for the case where the user
 * has a working flexi base (e.g. OctoCustom) designed to host a custom
 * head on top, and a separate Meshy mesh whose head region they want
 * planted on the base.
 *
 * EXPERIMENTAL / CLI-ONLY: reachable only via `src/scripts/headswap-cli.ts`
 * (`pnpm tsx src/scripts/headswap-cli.ts <octopus.3mf> <meshy.3mf> <out.3mf>`).
 * No API route or UI exposes it. Not part of the shipped product surface; the
 * web flexify entry point is `src/app/api/flexify/route.ts`.
 *
 * Pipeline:
 *   ... (unchanged)
```

- [ ] **Step 2: Verify the build** — `npx tsc --noEmit` — Expected: 0 errors (comment-only edit).

- [ ] **Step 3: Verify it is still CLI-only** — `grep -rn "headSwap\|headswap" src tests --include="*.ts" --include="*.tsx" | grep -v "headswap.ts:" | grep -v "headswap-cli.ts:"` — Expected: no output (zero non-CLI importers), confirming the marker is accurate.

- [ ] **Step 4: (verification covered by Steps 2-3 — no unit test for a doc comment.)**

- [ ] **Step 5: Commit** — `git add src/lib/flexify/headswap.ts` then `git commit -m "docs(flexify): mark headSwap experimental / CLI-only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.9: Move the committed `debug-*` scripts out of `src/scripts/` [destructive]

**Files:**
- Modify: `.gitignore` (add `/scripts/debug/`)
- Delete (git-tracked, via move): the 8 `debug-*` scripts under `src/scripts/`

`git ls-files src/scripts` lists 13 tracked files; 8 are `debug-*` (`debug-all-iterations.ts`, `debug-grayscale-values.ts`, `debug-latest-3mf.ts`, `debug-latest-iteration.ts`, `debug-nesting.ts`, `debug-sat-image.ts`, `debug-sat-pixels.ts`, `debug-trace.ts`). The non-debug scripts (`analyze-flexi.ts`, `export-logo-body.ts`, `flexify-cli.ts`, `headswap-cli.ts`, `stress-boolean.ts`) STAY — they are named operational/CLI tools, not the finding's target. No `package.json` script references the debug ones (grep confirmed they're only run ad-hoc via `pnpm tsx`), and no `src/` import pulls them in. Move them to a gitignored `scripts/debug/` so they survive locally but leave the tracked tree.

- [ ] **Step 1: Confirm zero importers of the debug scripts** — `grep -rn "scripts/debug-" src tests --include="*.ts" --include="*.tsx"` and `grep -n "debug-" package.json` — Expected: no output from either (nothing imports or scripts them — safe to untrack).

- [ ] **Step 2: Add the ignore + move the files** — append to `.gitignore` under the existing `# debug` section:

```
# ad-hoc debug scripts (kept locally, not tracked)
/scripts/debug/
```

Then move all 8 (preserves local copies, stages the deletions):

```bash
mkdir -p scripts/debug
git mv src/scripts/debug-all-iterations.ts src/scripts/debug-grayscale-values.ts \
       src/scripts/debug-latest-3mf.ts src/scripts/debug-latest-iteration.ts \
       src/scripts/debug-nesting.ts src/scripts/debug-sat-image.ts \
       src/scripts/debug-sat-pixels.ts src/scripts/debug-trace.ts \
       scripts/debug/
```

- [ ] **Step 3: Verify the move + that tsc/suite are unaffected** — `git ls-files src/scripts scripts/debug` — Expected: `src/scripts` now lists only the 5 non-debug scripts; `scripts/debug` lists nothing (the dir is gitignored, so the moved files are untracked-but-present on disk — confirm with `ls scripts/debug` showing the 8 files). Then `npx tsc --noEmit` — Expected: 0 errors (these scripts aren't in the app build graph). Then `pnpm test` — Expected: PASS — full suite green.

- [ ] **Step 4: (no unit test — verification is the ls/tsc/test triple above.)**

- [ ] **Step 5: Commit** — `git add .gitignore src/scripts` then `git commit -m "chore(scripts): untrack ad-hoc debug-* scripts (move to gitignored scripts/debug)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.10: Delete the production-dead `repair-mesh.ts` module + its test [destructive]

**Files:**
- Delete: `src/lib/compose/repair-mesh.ts`
- Delete: `tests/unit/repair-mesh.test.ts`
- Modify: `src/lib/mesh/validity.ts:6` (drop the stale doc reference)

Grep confirmed the only importer of `repair-mesh.ts` (all four exports: `repairAndPrepareMesh`, `standCylinderUpright`, `groundMesh`, `orientWiderEndDown`) is `tests/unit/repair-mesh.test.ts`. The sole other mention is a doc comment in `validity.ts:6` (`see src/lib/compose/repair-mesh.ts for that`). Production-dead → delete module + test, fix the dangling doc reference. Do this LAST so the suite is otherwise green when the test count drops.

- [ ] **Step 1: Re-confirm zero production importers right before deleting** — `grep -rn "compose/repair-mesh\|repairAndPrepareMesh\|standCylinderUpright\|orientWiderEndDown\|groundMesh" src --include="*.ts" --include="*.tsx"` — Expected: only `src/lib/compose/repair-mesh.ts` (self) and `src/lib/mesh/validity.ts:6` (doc comment) — NO importer under `src/app`, `src/lib/design`, `src/lib/import`, or `src/lib/flexify`.

- [ ] **Step 2: Delete + fix the doc comment** —

```bash
git rm src/lib/compose/repair-mesh.ts tests/unit/repair-mesh.test.ts
```

Then edit `src/lib/mesh/validity.ts:6` to drop the now-dead reference:

```ts
// was: * surface? It does NOT repair anything (see src/lib/compose/repair-mesh.ts for
// was: * that) and it does NOT measure wall thickness (deferred to a later phase).
 * surface? It does NOT repair anything and it does NOT measure wall thickness
 * (deferred to a later phase).
```

- [ ] **Step 3: Verify nothing breaks** — `npx tsc --noEmit` — Expected: 0 errors (no dangling import). Then `grep -rn "repair-mesh" src tests` — Expected: no output (all references gone, satisfying the phase acceptance "`repair-mesh` references gone").

- [ ] **Step 4: Run the full suite** — `pnpm test` — Expected: PASS — green, with the `repair-mesh.test.ts` cases (was ~12 tests) no longer collected and no orphaned-import failures.

- [ ] **Step 5: Commit** — `git add src/lib/compose/repair-mesh.ts tests/unit/repair-mesh.test.ts src/lib/mesh/validity.ts` then `git commit -m "refactor(compose): delete production-dead repair-mesh module + test

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6.11: Phase-close verification gate

**Files:** none (verification only)

The phase acceptance is "tsc + full suite green; no behavior change (consolidation only); `repair-mesh` references gone." Run the gate end-to-end before handing off.

- [ ] **Step 1: Lint** — `pnpm lint` — Expected: 0 errors / 0 warnings (no new unused imports from the helper extractions; baseline was 0/0).

- [ ] **Step 2: Types** — `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 3: Tests** — `pnpm test` — Expected: PASS — full suite green, count = the spec baseline (175 pass / 1 skip) MINUS the deleted `repair-mesh.test.ts` cases PLUS the new `persist`/`ops-frame`/`validation-report` tests added in this phase; net no failures.

- [ ] **Step 4: Dead-reference + dup check** — `grep -rn "repair-mesh" src tests` (Expected: no output) and `grep -rn "async function persistMesh\|function makeFrame\|function orientAlongNormal" src/app src/lib/import/ops/add-logo.ts src/lib/import/ops/hole.ts` (Expected: no output — the only definitions now live in `src/lib/storage/persist.ts` and `src/lib/import/ops/_shared.ts`).

- [ ] **Step 5: (no commit — verification gate only; all code changes were committed per task.)**

---

I have all the grounding I need. The build uses Turbopack-style hashed chunk names. I'll write the verification for finding 1 as a grep over the built chunk for `three`/r3f symbols being absent from the workspace's eager chunk, using `grep -rl`. Now I'll produce the phase plan.

```markdown
## Phase 7 — Performance

Defer the ~928KB three/R3F/drei viewer bundle off the workspace's eager chunk, and kill two O(n)-per-vertex hot paths (3MF parse spread-push, DynamicGrid main-thread scan) by reusing data we already compute.

### Task 7.1: Add a large-mesh roundtrip + index-write assertion to the 3MF test []

This locks current behavior (exact float roundtrip) AND adds a many-triangle case so the preallocation refactor in 7.2 can't silently corrupt vertex ordering. Pure function, vitest `node` env — real unit test.

**Files:**
- Test: `tests/unit/3mf.test.ts`

- [ ] **Step 1: Write the failing test** — append a second `it()` to the existing `describe('3MF serialization and parsing roundtrip', ...)` block (current file ends at `tests/unit/3mf.test.ts:45`). It generates 2000 triangles, roundtrips through `serialize3mf` → `parse3mf`, and asserts exact float equality + length. This will PASS against current code (it's a characterization test) — so make the assertion that *encodes the new contract*: that parse produces a `Float32Array` of exactly `9 * triangleCount` and equals the input ordering.

```ts
  it('roundtrips a large single-body mesh without reordering vertices', () => {
    // 2000 triangles → 18000 floats. Exercises the preallocated index-write path.
    const TRI = 2000
    const positions = new Float32Array(TRI * 9)
    for (let i = 0; i < positions.length; i++) {
      // deterministic, non-degenerate coords (avoid all-zero triangles)
      positions[i] = ((i * 7) % 333) + (i % 9) * 0.5
    }

    const original: MeshBodyData[] = [{ positions, extruder: 'A', label: 'Big' }]

    const zipBytes = serialize3mf(original)
    const parsed = parse3mf(zipBytes)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].positions).toBeInstanceOf(Float32Array)
    // 9 floats per triangle, no dropped/duplicated vertices
    expect(parsed[0].positions).toHaveLength(TRI * 9)
    // exact ordering preserved (serialize writes indexed verts; parse must
    // re-expand in the same triangle order)
    expect(Array.from(parsed[0].positions)).toEqual(Array.from(positions))
  })
```

- [ ] **Step 2: Run test to verify it passes against current code** — `pnpm test tests/unit/3mf.test.ts` — Expected: PASS (this is a characterization test guarding 7.2; it must be green *before* the refactor so a regression in 7.2 turns it red). If it FAILS now, the spread-push path already corrupts large meshes — stop and report.
- [ ] **Step 3: (no implementation in this task)** — the test guards 7.2; there is no source change here.
- [ ] **Step 4: (covered by Step 2)**
- [ ] **Step 5: Commit** — `git add tests/unit/3mf.test.ts` then `git commit -m "test(3mf): guard large-mesh roundtrip ordering before parse refactor"`
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task 7.2: Preallocate Float32Array in parse-3mf instead of spread-push []

`parse-3mf.ts:73` does `positionsList.push(...pt1, ...pt2, ...pt3)` into a growing JS `number[]`, then `:79` does `new Float32Array(positionsList)` — two allocations + a per-triangle variadic spread (9 args/call). Replace with a single counting pass to size a `Float32Array`, then write by index. Same output, fewer allocations, no spread.

**Files:**
- Modify: `src/lib/3mf/parse-3mf.ts:57-83`
- Test: `tests/unit/3mf.test.ts` (from 7.1 — must stay green)

- [ ] **Step 1: Reuse the failing-guard test** — the 7.1 large-mesh test now becomes the regression gate. Before editing, confirm it's green: `pnpm test tests/unit/3mf.test.ts` — Expected: PASS.
- [ ] **Step 2: (guard already exists)** — no new test needed; 7.1 covers ordering + length, the original `it` (`3mf.test.ts:6-44`) covers the two-body A/B + extruder case.
- [ ] **Step 3: Implement** — replace the triangle loop body in `parseModelXml` (currently `src/lib/3mf/parse-3mf.ts:57-83`). Do a first pass to count valid triangles, allocate once, then write by index:

```ts
    // Parse triangles and infer extruder when p1 is present.
    // Two-pass: count valid triangles first so we can allocate the exact
    // Float32Array up front and write by index (no growing number[] + no
    // per-triangle spread).
    let extruder: 'A' | 'B' = 'A'

    // Pass 1: count valid triangles (all three verts resolvable).
    let triCount = 0
    triangleRegex.lastIndex = 0
    let cMatch: RegExpExecArray | null
    while ((cMatch = triangleRegex.exec(bodyContent)) !== null) {
      const a = parseInt(cMatch[1], 10)
      const b = parseInt(cMatch[2], 10)
      const c = parseInt(cMatch[3], 10)
      if (vertices[a] && vertices[b] && vertices[c]) triCount++
    }

    // Pass 2: fill the preallocated buffer (9 floats per triangle).
    const positions = new Float32Array(triCount * 9)
    let w = 0
    triangleRegex.lastIndex = 0
    let tMatch: RegExpExecArray | null
    while ((tMatch = triangleRegex.exec(bodyContent)) !== null) {
      const v1 = parseInt(tMatch[1], 10)
      const v2 = parseInt(tMatch[2], 10)
      const v3 = parseInt(tMatch[3], 10)
      const p1Attr = tMatch[4] // may be undefined when p1 isn't present
      if (p1Attr === '1') extruder = 'B'

      const pt1 = vertices[v1]
      const pt2 = vertices[v2]
      const pt3 = vertices[v3]
      if (pt1 && pt2 && pt3) {
        positions[w++] = pt1[0]; positions[w++] = pt1[1]; positions[w++] = pt1[2]
        positions[w++] = pt2[0]; positions[w++] = pt2[1]; positions[w++] = pt2[2]
        positions[w++] = pt3[0]; positions[w++] = pt3[1]; positions[w++] = pt3[2]
      }
    }

    if (positions.length > 0) {
      bodies.push({
        positions,
        extruder,
        label: `Body ${objId}`,
      })
    }
```

  Note: this replaces both `const positionsList: number[] = []` / the spread-push (old `:59`,`:73`) and the `new Float32Array(positionsList)` (old `:79`). The `vertices` array and the three regexes above (`parse-3mf.ts:36-55`) are unchanged.

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/3mf.test.ts` — Expected: PASS (both the original A/B roundtrip and the 7.1 large-mesh ordering test). Also run the integration suites that consume parse3mf: `pnpm test tests/integration/upload-3mf.test.ts tests/integration/api-generate-3mf.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/3mf/parse-3mf.ts` then `git commit -m "perf(3mf): preallocate Float32Array via vertex-count pass, drop spread-push"`
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task 7.3: Derive DynamicGrid size from boundingBox, not a full vertex scan []

`MeshViewer.tsx:72-83` `DynamicGrid` iterates *every* vertex (`for (let i = 0; i < positions.length; i += 3)`) on the main thread to find the max coordinate. The same buffer already gets a `computeBoundingBox()` in `FitCameraToObject` (`MeshViewer.tsx:42`). Compute the bbox once inside `DynamicGrid` via `BufferGeometry.computeBoundingBox()` and read `box.max`/`box.min` instead of scanning — three.js does the min/max in one native pass and we dispose the temp geometry.

This is render-bound (R3F `<Canvas>`) and vitest runs in `node` (no jsdom — see `vitest.config.ts:8`), so a unit render test is impractical. Verify by extracting the pure sizing math into a tiny helper and unit-testing *that*, then wiring `DynamicGrid` to it. The helper is the load-bearing logic; the bbox plumbing is mechanical.

**Files:**
- Modify: `src/components/MeshViewer.tsx:72-83`
- Test: `tests/unit/mesh/grid-size.test.ts` (new)

- [ ] **Step 1: Write the failing test** — extract the size formula (currently inline at `MeshViewer.tsx:79-80`) into an exported pure function `gridSizeFromExtent(maxAbs: number): number` in MeshViewer, and test it. The test imports from `src/components/MeshViewer`:

```ts
import { describe, it, expect } from 'vitest'
import { gridSizeFromExtent } from '@/components/MeshViewer'

describe('gridSizeFromExtent', () => {
  it('returns the tight Meshy-scale grid for sub-unit extents', () => {
    expect(gridSizeFromExtent(0.8)).toBe(4)
  })

  it('snaps to 50mm steps and clamps to [50, 1000] for mm-scale meshes', () => {
    // ceil((100 * 2.5) / 50) * 50 = ceil(5) * 50 = 250
    expect(gridSizeFromExtent(100)).toBe(250)
    // tiny but >=1: clamps up to the 50 floor
    expect(gridSizeFromExtent(1)).toBe(50)
    // huge: clamps down to the 1000 ceiling
    expect(gridSizeFromExtent(5000)).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/mesh/grid-size.test.ts` — Expected: FAIL (`gridSizeFromExtent` is not exported from `@/components/MeshViewer` — import resolves to `undefined`, call throws `TypeError`).
- [ ] **Step 3: Implement** — in `src/components/MeshViewer.tsx`, add the exported helper just above `DynamicGrid` and rewrite `DynamicGrid` (`MeshViewer.tsx:72-83`) to compute one bbox instead of scanning:

```ts
/** Pure: map a mesh's max absolute coordinate to a grid size.
 *  Meshy meshes arrive sub-unit (~1); JSCAD meshes are mm (10-300). */
export function gridSizeFromExtent(maxAbs: number): number {
  if (maxAbs < 1) return 4 // Meshy-scale meshes (~1 unit)
  return Math.max(50, Math.min(1000, Math.ceil((maxAbs * 2.5) / 50) * 50))
}

function DynamicGrid({ positions }: { positions: Float32Array | null }) {
  const size = useMemo(() => {
    if (!positions) return 200
    // Reuse three's native min/max pass instead of a JS per-vertex loop.
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.computeBoundingBox()
    const box = geom.boundingBox!
    const maxAbs = Math.max(
      Math.abs(box.min.x), Math.abs(box.max.x),
      Math.abs(box.min.y), Math.abs(box.max.y),
      Math.abs(box.min.z), Math.abs(box.max.z),
    )
    geom.dispose()
    return gridSizeFromExtent(maxAbs)
  }, [positions])
  return <gridHelper args={[size, Math.max(10, Math.round(size / 10)), '#888', '#ddd']} />
}
```

  The `gridHelper` return line is unchanged from `MeshViewer.tsx:82`. `THREE` and `useMemo` are already imported (`MeshViewer.tsx:2,4-5`).

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/mesh/grid-size.test.ts` — Expected: PASS. Then `pnpm test` (full suite) — Expected: no regressions.
- [ ] **Step 5: Commit** — `git add src/components/MeshViewer.tsx tests/unit/mesh/grid-size.test.ts` then `git commit -m "perf(viewer): size DynamicGrid from boundingBox, drop per-vertex scan"`
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

### Task 7.4: Lazy-load MeshViewer via next/dynamic with ssr:false + skeleton (structural)

`ProjectWorkspace.tsx:6` statically imports `MeshViewer`, pulling the entire three + R3F + drei graph (~928KB) into the workspace's eager client chunk. Convert to `dynamic(() => import('./MeshViewer'), { ssr: false, loading: ... })`. **(structural)** — this changes how a child component is wired (default-export consumption) and the `ssr:false` boundary is a real behavior change the executor should pause on. Per `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:39,66,68-72`, `ssr:false` is valid here because `ProjectWorkspace` is `'use client'` (`ProjectWorkspace.tsx:1`); the doc warns `ssr:false` only works inside Client Components.

Ref caveat: `MeshViewer` is a `forwardRef` component (`MeshViewer.tsx:155` `MeshViewerInner = forwardRef<MeshViewerHandle, MeshViewerProps>`) and `ProjectWorkspace.tsx:298` passes `ref={meshViewerRef}` and calls `meshViewerRef.current.capturePreviews()` (`ProjectWorkspace.tsx:107-109`). React 19 + Next 16.2's `dynamic()` (a `React.lazy` + Suspense composite, per the doc :24) forwards refs to the resolved component, so the imperative handle survives. We must NOT lose the ref — the 3MF preview-capture flow depends on it.

This is bundle-graph wiring, not pure logic — verify with a production build chunk probe, not a unit test.

**On the spec's "split drei/controls" sub-item:** it is subsumed by this single `dynamic()` boundary, not a separate task. `@react-three/drei` and the R3F controls are imported ONLY by `MeshViewer` (`MeshViewer.tsx:2-5`), so deferring `MeshViewer` moves three + R3F + drei off the eager chunk together — the acceptance ("workspace transferred JS drops below the current 248KB-gz single chunk") is met by the boundary alone. If the resulting async chunk is still undesirably large, a follow-up Turbopack `splitChunks` cacheGroup can break drei out, but that is optional polish, not required by the finding — note it in the phase report rather than forcing a separate task.

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx:6` (the import) and `src/components/ProjectWorkspace.tsx:296-307` (keep the JSX usage / ref intact)

- [ ] **Step 1: Pre-change baseline probe** — capture which built chunk(s) currently contain the three.js graph alongside the workspace. Run a clean build and record the baseline:
  ```bash
  pnpm build && \
  grep -rl "BufferGeometry" .next/static/chunks/ | wc -l
  ```
  Expected: a small count of chunks reference three; note them. (Baseline only — confirms the build is green before touching the import.)

- [ ] **Step 2: (no failing unit test — render/bundle-bound)** — vitest is `node` env (`vitest.config.ts:8`), cannot render R3F; verification is the post-build chunk probe in Step 4.

- [ ] **Step 3: Implement** — in `src/components/ProjectWorkspace.tsx`:

  Replace the static import at line 6:
  ```ts
  import MeshViewer, { type MeshBody, type MeshViewerHandle } from './MeshViewer'
  ```
  with a type-only import plus a `dynamic()` boundary (types must stay static — they're erased at build time and `dynamic` only carries the runtime component):
  ```ts
  import dynamic from 'next/dynamic'
  import type { MeshBody, MeshViewerHandle } from './MeshViewer'

  // Defer the three.js + R3F + drei graph (~928KB) off the workspace's eager
  // chunk. ssr:false is valid here — ProjectWorkspace is a Client Component
  // (see next docs: lazy-loading, ssr:false only works in Client Components).
  // The viewer relies on WebGL/canvas APIs that don't exist during SSR.
  const MeshViewer = dynamic(() => import('./MeshViewer'), {
    ssr: false,
    loading: () => (
      <div
        data-testid="viewer-skeleton"
        className="absolute inset-0 flex items-center justify-center bg-gray-50 text-gray-400 text-sm"
      >
        Carregando visualizador 3D…
      </div>
    ),
  })
  ```
  Leave the JSX usage at `ProjectWorkspace.tsx:297-307` exactly as-is — `ref={meshViewerRef}`, `positions`, `bodies`, `fitKey`, `bodyColor`, `logoColor`, `pickMode`, `onPick`, `pickMarker` all stay. `MeshBody` / `MeshViewerHandle` continue to come from the type import (used at `ProjectWorkspace.tsx:50,57`). UI string is PT-BR per convention.

- [ ] **Step 4: Verify the chunk split (post-build probe)** — rebuild and confirm the workspace page no longer eagerly pulls three.js, and that the viewer now lives in its own async chunk:
  ```bash
  pnpm build
  # The MeshViewer module should resolve to a dynamic chunk; three's symbols
  # should appear in async chunks, not in the project route's entry.
  grep -rl "MeshViewerInner\|BufferGeometry" .next/static/chunks/ | sort
  ```
  Expected: build is green, and `MeshViewer`/`BufferGeometry` now resolve into async/lazy chunks (a `dynamic()`-split chunk distinct from the workspace entry). Compare against the 7.4-Step-1 baseline — the workspace's eager entry should no longer be in the list that pins three.js. If `pnpm build` errors with *"ssr: false is not allowed with next/dynamic in Server Components"*, the import was placed in a non-`'use client'` module — confirm it stayed in `ProjectWorkspace.tsx` (which has `'use client'` at line 1).

- [ ] **Step 5: Manual ref smoke (load-bearing — do not skip)** — start the app, open a project workspace, upload a `.3mf`, and confirm the auto preview-capture still fires (the `meshViewerRef.current.capturePreviews()` path at `ProjectWorkspace.tsx:107-109` logs `[ProjectWorkspace] preview capture failed` on error). Expected: no console error, previews captured — proves `dynamic()` forwarded the ref to the `forwardRef` handle. Then commit:
  `git add src/components/ProjectWorkspace.tsx` then `git commit -m "perf(workspace): lazy-load MeshViewer (ssr:false) to defer 928KB three/R3F chunk"`
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
```

The plan above is my complete deliverable. Key grounding notes for the caller:

- **All four Task-7.x blocks are grounded in code I read.** Stale spec line refs corrected: the spread-push is at `parse-3mf.ts:73` and `new Float32Array(positionsList)` at `:79` (spec was right); the `DynamicGrid` scan is `MeshViewer.tsx:72-83` (spec said ~76, it's the loop at 76-78); `computeBoundingBox` is at `MeshViewer.tsx:42` inside `FitCameraToObject` (spec ~42, correct); the static import is `ProjectWorkspace.tsx:6` (correct), JSX usage at `:297-307`.

- **Two real constraints the spec didn't flag, now handled in the plan:**
  1. `vitest.config.ts:8` sets `environment: 'node'` — no jsdom — so findings 1 and 3 cannot use a render test. Finding 3 (7.3) is verified by extracting the pure sizing math into an exported `gridSizeFromExtent()` and unit-testing that; finding 1 (7.4) is verified by a `pnpm build` chunk probe + manual ref smoke.
  2. `MeshViewer` is a `forwardRef` component (`MeshViewer.tsx:155`) consumed with `ref={meshViewerRef}` and `meshViewerRef.current.capturePreviews()` (`ProjectWorkspace.tsx:107-109,298`). The `dynamic()` conversion must preserve ref forwarding — Task 7.4 keeps the type import static, marks the task **(structural)**, and adds an explicit manual ref-smoke step because the 3MF preview-capture flow depends on it.

- **Versions confirmed:** next 16.2.6, react 19.2.4, vitest 4.1.6, three ^0.184, @react-three/fiber ^9.6.1, drei ^10.7.7. `pnpm test` → `vitest run`. `ssr:false` validity confirmed against `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` (only works in Client Components; `ProjectWorkspace.tsx:1` is `'use client'`).

- **No existing `next/dynamic` usage** anywhere in `src/` — 7.4 introduces the first dynamic boundary.

- Shared helpers (`apiError`, `persist`, `loadJscad`) are not needed by this phase, so none are redefined.

---

I have everything I need. The auto-name will be a pure `deriveProjectTitle(prompt)` helper (unit-testable in node), pagination a pure `paginate` helper. Now I'll write the Phase 8 plan grounded in the real code I read.

## Phase 8 — UX polish + a11y + PT-BR locale

**Goal:** Bring the generate → preview → slice → export loop to a premium, accessible, fully PT-BR finish — kill the broken dark mode, add loading states, sweep every EN string, fix contrast/touch-target/canvas a11y, de-jargon the UI, and add the not-found page, inline upload errors, project auto-naming, and list pagination.

> Note on testing: `vitest.config.ts` runs `environment: 'node'`, `include: ['tests/unit/**/*.test.ts']` (`.ts` only) with no testing-library/jsdom-DOM render harness — component render tests are not in scope. UI/copy tasks are verified via Playwright at 390×844 and 1440×900 (per the audit acceptance) or a prod-build smoke; only pure extracted helpers (`deriveProjectTitle`, `paginate`) get vitest unit tests.

---

### Task 8.1: Remove the broken dark-mode block + fix hardcoded Arial font

**Files:**
- Modify: `src/app/globals.css:15-26`

The `@media (prefers-color-scheme: dark)` block swaps `--background`/`--foreground` to dark values, but no surface (cards, chat bubbles, panels) was restyled — leaving e.g. dark text on the still-white chat panel (the audit's 1.07:1 invisible-text finding). The `body` also hardcodes `Arial, Helvetica, sans-serif` even though Geist is loaded into `--font-sans` (globals.css:11). Remove the dark block and point the body at the Geist token.

- [ ] **Step 1: Implement** — edit `src/app/globals.css`, delete lines 15-20 (the entire `@media (prefers-color-scheme: dark)` block) and change the `body` font-family (line 25). Resulting file:

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
}
```

- [ ] **Step 2: Verify** — `pnpm build` then open `/sign-in` in a browser with OS dark mode ON; confirm the page stays light (white bg, near-black text) and body computed `font-family` resolves to the Geist variable. Expected: no dark inversion, no invisible text, Geist applied.
- [ ] **Step 3: Commit** — `git add src/app/globals.css` then `git commit -m "fix(ui): remove unstyled dark-mode block; use Geist font var in body"`

---

### Task 8.2: Real site metadata + per-project `generateMetadata`

**Files:**
- Modify: `src/app/layout.tsx:15-18,27`
- Modify: `src/app/projects/[id]/page.tsx`

Currently `layout.tsx:15-18` ships the scaffold `title: "Create Next App"` / `description: "Generated by create next app"`, and the `<html lang="en">` (layout.tsx:27) is wrong for a PT-BR UI.

- [ ] **Step 1: Implement layout** — in `src/app/layout.tsx`, replace the metadata (lines 15-18) and set `lang="pt-BR"` (line 27):

```tsx
export const metadata: Metadata = {
  title: {
    default: 'Gerador 3D',
    template: '%s · Gerador 3D',
  },
  description: 'Gere, visualize e fatie peças para impressão 3D a partir de uma descrição ou imagem.',
}
```

```tsx
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
```

- [ ] **Step 2: Implement per-project metadata** — in `src/app/projects/[id]/page.tsx`, add a `generateMetadata` export above the page component. It re-uses the same owner-scoped query shape already in the page (auth → projects where `id` AND `userId`):

```tsx
import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return { title: 'Projeto' }
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1)
  return { title: project?.title ?? 'Projeto' }
}
```

- [ ] **Step 3: Verify** — `pnpm build && pnpm start`; `curl -s localhost:3000/sign-in | grep -o '<title>[^<]*</title>'` → Expected: `<title>Gerador 3D</title>` (no "Create Next App") and `curl -s localhost:3000/sign-in | grep -o 'lang="[^"]*"'` → Expected: `lang="pt-BR"`.
- [ ] **Step 4: Commit** — `git add src/app/layout.tsx src/app/projects/[id]/page.tsx` then `git commit -m "feat(ui): real PT-BR site metadata + per-project generateMetadata"`

---

### Task 8.3: PT-BR sweep — home (`page.tsx`) strings + labelled input

**Files:**
- Modify: `src/app/page.tsx:21,28,38,40,46,53`

EN strings on the project list: `"Your projects"` (:21), `"{email} — sign out"` (:28), placeholder `"New project title"` (:38), button `"New"` (:40), `"No projects yet."` (:46). Also the date at :53 uses `toLocaleString()` with no locale (renders in the server/OS locale), and the title input (:35-39) has only a placeholder (a11y: no label).

- [ ] **Step 1: Implement** — in `src/app/page.tsx`:

```tsx
        <h1 className="text-2xl font-semibold">Seus projetos</h1>
```
```tsx
          <button className="text-sm text-gray-600 hover:underline min-h-11">
            {session.user.email} — sair
          </button>
```
```tsx
      <form action={createProject} className="flex gap-2">
        <label htmlFor="new-project-title" className="sr-only">
          Título do novo projeto
        </label>
        <input
          id="new-project-title"
          name="title"
          placeholder="Título do novo projeto"
          className="flex-1 border rounded px-3 py-2 min-h-11"
        />
        <button type="submit" className="bg-black text-white rounded px-4 py-2 min-h-11">
          Criar
        </button>
      </form>
```
```tsx
          <li className="text-gray-600 text-sm">Nenhum projeto ainda.</li>
```
```tsx
              <div className="text-xs text-gray-600">{p.updatedAt.toLocaleString('pt-BR')}</div>
```

(`sr-only` is the Tailwind visually-hidden utility — available out of the box with the `@import "tailwindcss"` v4 setup.)

- [ ] **Step 2: Verify** — covered together with the snapshot assertion in Task 8.13 (no EN leaks). Quick check now: `pnpm build && pnpm start`; with `E2E_ALLOW_TEST_LOGIN` session, the home renders "Seus projetos"/"Criar"/"sair".
- [ ] **Step 3: Commit** — `git add src/app/page.tsx` then `git commit -m "feat(ui): PT-BR home strings + labelled project-title input + locale dates"`

---

### Task 8.4: PT-BR sweep + error handling on `/sign-in`

**Files:**
- Modify: `src/app/sign-in/page.tsx:13,14,17,21,24`

EN strings: `"Sign in"` (:13), `"We'll email you a magic link…"` (:14), placeholder `"you@example.com"` is fine but the input has no label (:17-22), and `"Send magic link"` (:24).

Note: the existing e2e `homepage.spec.ts` asserts `expect(page.locator('h1')).toContainText('Sign in')` — that assertion must be updated to the PT-BR string in this same task to keep the gate green.

- [ ] **Step 1: Implement** — in `src/app/sign-in/page.tsx`:

```tsx
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="text-sm text-gray-600">
          Vamos te enviar um link mágico por e-mail. Só endereços autorizados conseguem entrar.
        </p>
        <label htmlFor="email" className="sr-only">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="voce@exemplo.com"
          className="w-full border rounded px-3 py-2 min-h-11"
        />
        <button type="submit" className="w-full bg-black text-white rounded py-2 min-h-11">
          Enviar link mágico
        </button>
```

- [ ] **Step 2: Implement** — update the existing e2e assertion in `tests/e2e/homepage.spec.ts` from `toContainText('Sign in')` to `toContainText('Entrar')`.
- [ ] **Step 3: Verify** — `pnpm test:e2e tests/e2e/homepage.spec.ts` (against `:3001` per Phase 2). Expected: PASS with the PT-BR `h1`.
- [ ] **Step 4: Commit** — `git add src/app/sign-in/page.tsx tests/e2e/homepage.spec.ts` then `git commit -m "feat(ui): PT-BR sign-in copy + labelled email input"`

---

### Task 8.5: PT-BR sweep + de-jargon in `Chat.tsx`

**Files:**
- Modify: `src/components/Chat.tsx:114,247,272,319,388,398`

EN/jargon strings: `alert("Upload failed: …")` (:114, handled in Task 8.10), assistant fallback label `"Generated${dims}"` (:163) and `"Error: …"` (:183), the strategy badge text `'meshy'/'jscad'` (:213, a dev/internal label), `"Design interpretado pelo LLM"` (:247, dev jargon — "LLM"), `"Editar JSON — pula o LLM, vai direto pro generator"` (:272, jargon), spinner `"Generating…"` (:319), input placeholder `"Describe what to build..."` (:388), and submit `"Send"` (:398). Also `"Editar JSON"` button (:264) and `aria-label`s `"Remove attached image"` (:354) / `"Attach image"` (:380).

This is the broadest single file. Per-string mapping:

| Location | EN / jargon | PT-BR (user-facing) |
|---|---|---|
| :163 fallback `label` | `Generated${dims}` | `Modelo gerado${dims}` |
| :183 catch | `Error: ${msg}` | `Erro: ${msg}` |
| :213 badge | `meshy` / `jscad` | `imagem` / `paramétrico` |
| :247 summary | `Design interpretado pelo LLM — …` | `Como interpretamos seu pedido — …` |
| :264 button | `Editar JSON` | `Ajustar parâmetros` |
| :272 panel title | `Editar design — pula o LLM, vai direto pro generator` | `Ajustar parâmetros — aplica direto, sem reinterpretar` |
| :319 spinner | `Generating…` | `Gerando…` |
| :388 placeholder | `Describe what to build...` | `Descreva o que quer criar — ex.: "porta-lata cilíndrico com logo"` |
| :398 submit | `Send` | `Enviar` |
| :354 aria-label | `Remove attached image` | `Remover imagem anexada` |
| :380-381 aria/title | `Attach image` | `Anexar imagem` |

The badge derives from `m.strategy` which is always `'generative'` here (Chat only emits generative results, line 168); the label `imagem` reflects the user-facing reality (image/text-to-3D) rather than the vendor name `meshy`.

- [ ] **Step 1: Implement** — apply each replacement above. Key blocks:

```tsx
      const label = (body.meta.kind && labelByKind[body.meta.kind]) ?? `Modelo gerado${dims}`
```
```tsx
      setMessages((m) => [...m, { role: 'assistant', text: `Erro: ${(e as Error).message}` }])
```
```tsx
            {m.role === 'assistant' && m.strategy && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-700 uppercase align-top">
                {m.strategy === 'generative' ? 'imagem' : 'paramétrico'}
              </span>
            )}
```
```tsx
                <summary className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold cursor-pointer select-none min-h-11 flex items-center">
                  Como interpretamos seu pedido — {designSummary(m.design)}
                </summary>
```
```tsx
                  <button
                    onClick={() => setEditingDesign({ /* unchanged */ })}
                    className="text-[10px] uppercase tracking-wide text-blue-700 border border-blue-300 rounded px-2 py-0.5 min-h-11 hover:bg-blue-100 whitespace-nowrap"
                  >
                    Ajustar parâmetros
                  </button>
```
```tsx
                <div className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold mb-1.5">
                  Ajustar parâmetros — aplica direto, sem reinterpretar
                </div>
```
```tsx
        {busy && <div className="text-gray-500 text-xs">Gerando…</div>}
```
```tsx
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='Descreva o que quer criar — ex.: "porta-lata cilíndrico com logo"'
          aria-label="Descreva o que quer criar"
          className="flex-1 border rounded px-3 py-2 min-h-11"
          disabled={busy}
          data-testid="chat-input"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 min-h-11 disabled:opacity-50"
          disabled={busy || uploading || (!draft.trim() && !attachedImage)}
        >
          Enviar
        </button>
```
```tsx
          <button
            onClick={() => setAttachedImage(null)}
            className="text-gray-500 hover:text-red-500 text-sm px-2 min-h-11 min-w-11"
            aria-label="Remover imagem anexada"
          >
            ✕
          </button>
```
```tsx
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || uploading}
          className="px-3 py-2 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 min-h-11"
          aria-label="Anexar imagem"
          title="Anexar imagem"
        >
          {uploading ? '⏳' : '📎'}
        </button>
```

(The `Generating…` → `Gerando…` change also fixes the contrast finding: `text-gray-400` → `text-gray-500`.)

- [ ] **Step 2: Verify** — `pnpm lint && npx tsc --noEmit` (no test render harness for this component). Expected: 0 errors. Visual/snapshot confirmation in Task 8.13.
- [ ] **Step 3: Commit** — `git add src/components/Chat.tsx` then `git commit -m "feat(ui): PT-BR + de-jargon Chat copy, labelled input, 44px touch targets, gray-500 spinner"`

---

### Task 8.6: PT-BR sweep + contrast fixes in `ProjectWorkspace.tsx`

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx:319-323,326,364`

Contrast failures: the active pick-mode button is `bg-orange-500 text-white` (:319-322) and the "Aplicar logo" button is `bg-orange-500 text-white` (:364) — white-on-orange-500 fails AA. Darken to `orange-600`. The `placing` label `"Aplicando…"` (:366) and `"limpar"` (:369) are already PT-BR. The "Logo aqui"/"Cancelar" button text is PT-BR. No raw-JSCAD message reaches the chat in the current code path — the `it.jscadCode` assistant message at :198 only fires for `strategy === 'parametric'`, and the audit flags it as dev-facing raw code shown verbatim; replace that message body with a friendly label (the code stays available via the iteration, not dumped in chat).

- [ ] **Step 1: Implement** — in `src/components/ProjectWorkspace.tsx`:

Pick-toggle button active state (:319-323):
```tsx
              className={`px-3 py-2 rounded text-sm font-medium border shadow-sm min-h-11 ${
                pickMode
                  ? 'bg-orange-600 text-white border-orange-700'
                  : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
              }`}
```

"Aplicar logo" button (:361-367):
```tsx
                <button
                  onClick={applyLogoPlacement}
                  disabled={placing}
                  className="px-3 py-2 rounded bg-orange-600 text-white font-medium min-h-11 disabled:opacity-60"
                >
                  {placing ? 'Aplicando…' : 'Aplicar logo'}
                </button>
```

Parametric assistant message (replace raw `it.jscadCode` dump at :195-199):
```tsx
    if (it.strategy === 'parametric' && it.jscadCode) {
      return [
        userMsg,
        { role: 'assistant', text: 'Modelo paramétrico gerado', iterationId: it.id, strategy: 'parametric' },
      ]
    }
```

(The generative branch `const label = 'Generated'` at :206 → `'Modelo gerado'`.)

```tsx
      const label = 'Modelo gerado'
```

- [ ] **Step 2: Verify** — `pnpm lint && npx tsc --noEmit`. Expected: 0 errors. Contrast confirmed via the aXe-style spot-check in Task 8.13.
- [ ] **Step 3: Commit** — `git add src/components/ProjectWorkspace.tsx` then `git commit -m "feat(ui): PT-BR workspace copy, orange-600 contrast fix, friendly parametric message"`

---

### Task 8.7: 44px touch targets on the color pickers + the top-right stack overlap fix (structural)

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx:377-399,401`
- Modify: `src/components/SliceButton.tsx:99`

(structural) — this changes the shared top-right layout contract between two components. Both `SliceButton` (`absolute top-4 right-4 … z-10`, SliceButton.tsx:99) and the color panel (`absolute top-4 right-4 z-10`, ProjectWorkspace.tsx:377) anchor to the same corner and overlap. Also the color `<input type="color">` swatches are `w-6 h-6` (24px, ProjectWorkspace.tsx:385,395) — below the 44px touch minimum.

Fix: keep the color panel at `top-4 right-4`, and offset `SliceButton` below it. Since the panel height is dynamic, the cleanest non-coordinating fix is to give SliceButton a larger top offset (`top-[4.5rem]` ≈ 72px) so it clears the two-row color panel. Color swatches get a 44px hit area via a wrapper while the visual swatch stays compact.

- [ ] **Step 1: Implement SliceButton offset** — `src/components/SliceButton.tsx:99`:

```tsx
    <div className="absolute top-[4.5rem] right-4 flex flex-col items-end gap-2 z-10">
```

- [ ] **Step 2: Implement color-picker hit areas** — `src/components/ProjectWorkspace.tsx`, both picker rows (:379-388 and :389-398). Wrap each `<input type="color">` so the interactive area is ≥44px while the visible swatch stays small:

```tsx
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="body-color-picker"
              value={bodyColor}
              onChange={(e) => setBodyColor(e.target.value)}
              aria-label="Cor da base (extrusora A)"
              className="w-11 h-11 rounded border border-gray-300 cursor-pointer p-0"
            />
            <label htmlFor="body-color-picker" className="cursor-pointer font-medium">Cor da Base (A)</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="logo-color-picker"
              value={logoColor}
              onChange={(e) => setLogoColor(e.target.value)}
              aria-label="Cor do logo (extrusora B)"
              className="w-11 h-11 rounded border border-gray-300 cursor-pointer p-0"
            />
            <label htmlFor="logo-color-picker" className="cursor-pointer font-medium">Cor do Logo (B)</label>
          </div>
```

- [ ] **Step 3: Verify** — Playwright at 1440×900 and 390×844: assert the SliceButton and color panel bounding boxes do not intersect (`expect(sliceBox.y).toBeGreaterThanOrEqual(colorBox.y + colorBox.height)`), and each color input box is ≥44×44. Show the probe in the snapshot spec (Task 8.13). Expected: no overlap, hit areas ≥44px.
- [ ] **Step 4: Commit** — `git add src/components/SliceButton.tsx src/components/ProjectWorkspace.tsx` then `git commit -m "fix(ui): un-overlap SliceButton from color panel; 44px color-picker hit areas"`

---

### Task 8.8: PT-BR sweep + contrast in `SliceButton.tsx`, env name to logs only

**Files:**
- Modify: `src/components/SliceButton.tsx:106,115,126,132,139`

EN/jargon: button `"Slice for printing"` / `"Slicing…"` (:106), the offline banner exposes the internal env name `"SLICER_URL"` (:115), `"Print time:"` (:126), `"Filament:"` (:132), and the download button `"Download .3mf"` (:141) is `bg-emerald-600 text-white` — white-on-emerald-600 borderline-fails AA, darken to `emerald-700`.

- [ ] **Step 1: Implement** — in `src/components/SliceButton.tsx`:

```tsx
        {busy ? 'Fatiando…' : 'Fatiar para impressão'}
```
```tsx
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded px-3 py-2 text-xs max-w-xs">
          Serviço de fatiamento indisponível no momento. Tente novamente em instantes.
        </div>
```
(The env name `SLICER_URL` moves to a `console.warn` — wire it where the health probe flips `slicerOk` to false, SliceButton.tsx:35: `console.warn('[SliceButton] slicer health reported offline (check SLICER_URL)')`.)

```tsx
          <div>
            <span className="text-gray-600">Tempo de impressão: </span>
            <strong>{fmtPrintTime(result.meta.print_time_min)}</strong>
          </div>
          <div>
            <span className="text-gray-600">Filamento: </span>
            <strong>{fmtFilament(result.meta.filament_g)} · {fmtFilamentM(result.meta.filament_m)}</strong>
          </div>
          <button
            onClick={download}
            className="w-full bg-emerald-700 text-white rounded px-3 py-2 min-h-11"
          >
            Baixar .3mf
          </button>
```

**Keep Task 3.3's `fmtPrintTime`/`fmtFilament`/`fmtFilamentM` helpers** (Phase 3 already added them + the `filament_m` field) — this task only translates the labels and darkens the download button to `emerald-700`. Do NOT revert to inline `!= null` expressions or drop the `filament_m` (`· X.XX m`) display.

- [ ] **Step 2: Verify** — `pnpm lint && npx tsc --noEmit`. Expected: 0 errors. Copy/contrast confirmed in Task 8.13.
- [ ] **Step 3: Commit** — `git add src/components/SliceButton.tsx` then `git commit -m "feat(ui): PT-BR slice copy, emerald-700 contrast, SLICER_URL to logs only"`

---

### Task 8.9: Canvas a11y — `aria-label` + fallback + status `aria-live` + keyboard logo placement

**Files:**
- Modify: `src/components/MeshViewer.tsx:201`
- Modify: `src/components/ProjectWorkspace.tsx:403-407` (aria-live) and the logo-placement controls (keyboard path)

The R3F `<Canvas>` (MeshViewer.tsx:201) has no accessible name and no fallback content for non-WebGL/AT users. The error banner (ProjectWorkspace.tsx:403-407) has no `aria-live`, so screen readers don't announce failures. **And the logo placement is mouse-only** — `pickMode` → click-on-canvas → `onPick(...)` → `applyLogoPlacement` has no keyboard equivalent (spec line 175 + the Phase-8 acceptance's "keyboard" item). This task adds a keyboard-reachable numeric-input alternative that feeds the same placement handler.

- [ ] **Step 1: Implement Canvas a11y** — `src/components/MeshViewer.tsx:201`. `@react-three/fiber`'s `Canvas` forwards DOM props to its wrapping `<canvas>` and accepts `fallback` children for the WebGL-unavailable case:

```tsx
    <Canvas
      camera={{ position: [80, 80, 80], fov: 40 }}
      aria-label="Visualização 3D do modelo. Arraste para girar, role para dar zoom."
      role="img"
      fallback={<span>Visualização 3D indisponível neste navegador.</span>}
    >
```

- [ ] **Step 2: Implement aria-live on the error banner** — `src/components/ProjectWorkspace.tsx:403-407`:

```tsx
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute bottom-4 left-4 right-4 bg-red-50 text-red-900 border border-red-200 rounded p-3 text-xs"
          >
            <strong>Erro:</strong> {error}
          </div>
        )}
```

(`"Error:"` → `"Erro:"` also closes the EN leak in this banner.)

- [ ] **Step 3: Keyboard-accessible logo placement** — first READ the current placement path in `ProjectWorkspace.tsx`: find `pickMode`, the `onPick` callback, and the handler it calls (the audit names it `applyLogoPlacement`), and note the exact payload `onPick` produces (the surface point / face + offset shape). Then, in the logo controls block that today only renders the "Logo aqui" pick button (the same block Phase 3 gated to imported-mesh projects), add a small keyboard-reachable form that produces the SAME payload without the canvas pointer. Concrete shape (adapt the field names/payload to what `onPick` actually passes — do not invent a new placement contract):

```tsx
  {/* Keyboard alternative to click-to-place. Defaults to the mesh-bbox top-center;
      X/Y are mm offsets from that point. Calls the SAME handler as onPick. */}
  <fieldset className="mt-2 border-t pt-2 text-xs">
    <legend className="text-gray-600">Posição do logo (teclado)</legend>
    <label className="flex items-center gap-2 mt-1">
      X (mm)
      <input
        type="number" value={logoX} onChange={(e) => setLogoX(Number(e.target.value))}
        aria-label="Deslocamento X do logo em milímetros"
        className="border rounded px-2 min-h-11 w-24"
      />
    </label>
    <label className="flex items-center gap-2 mt-1">
      Y (mm)
      <input
        type="number" value={logoY} onChange={(e) => setLogoY(Number(e.target.value))}
        aria-label="Deslocamento Y do logo em milímetros"
        className="border rounded px-2 min-h-11 w-24"
      />
    </label>
    <button
      onClick={() => applyLogoPlacement(placementFromOffsets(logoX, logoY))}
      className="mt-2 min-h-11 px-3 rounded bg-orange-600 text-white"
    >
      Aplicar posição
    </button>
  </fieldset>
```

Add `const [logoX, setLogoX] = useState(0)` / `logoY` near the other state, and a tiny `placementFromOffsets(x, y)` that builds the same payload `onPick` passes (centered on the mesh bbox top face + the mm offsets — reuse the bbox already available to the viewer). The point is that a keyboard user can place the logo via inputs + "Aplicar" without ever clicking the canvas. (The `min-h-11` on inputs/button also satisfies the Task 8.7 touch-target rule.)

- [ ] **Step 4: Verify** — `pnpm build` then Playwright: `expect(page.getByRole('img', { name: /Visualização 3D/ })).toBeVisible()`; force an error path to assert `getByRole('alert')` appears; and a keyboard-only pass — `page.keyboard` tabs to the X/Y inputs, types offsets, activates "Aplicar posição", and asserts a placement iteration is created (same outcome as a canvas click). Expected: canvas labelled, error announced, logo placeable by keyboard.
- [ ] **Step 5: Commit** — `git add src/components/MeshViewer.tsx src/components/ProjectWorkspace.tsx` then `git commit -m "feat(a11y): label 3D canvas + fallback, aria-live banner, keyboard logo placement, PT-BR Erro"`

---

### Task 8.10: Inline upload-error banner (replace `alert()`)

**Files:**
- Modify: `src/components/Chat.tsx:80,114,358-359`

The upload failure path uses `alert("Upload failed: …")` (Chat.tsx:114) — blocking, EN, untestable. Replace with an inline dismissible banner using a new `uploadError` state.

- [ ] **Step 1: Implement** — `src/components/Chat.tsx`. Add state near the other `useState`s (after line 80):

```tsx
  const [uploadError, setUploadError] = useState<string | null>(null)
```

Replace the `catch` in `onFileChange` (Chat.tsx:113-115):
```tsx
    } catch (err) {
      console.error('[Chat] upload failed', err)
      setUploadError('Falha no upload. Verifique o arquivo e tente de novo.')
    } finally {
      setUploading(false)
    }
```
Also clear it at the start of `onFileChange` (after `setUploading(true)`, line 99): `setUploadError(null)`.

Render the banner just above the `<form>` (before line 360):
```tsx
      {uploadError && (
        <div
          role="alert"
          className="px-4 pb-2 pt-2 flex items-center gap-2 border-t bg-red-50 text-red-900 text-xs"
        >
          <span className="flex-1">{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="px-2 min-h-11 min-w-11 text-red-700 hover:text-red-900"
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}
```

- [ ] **Step 2: Verify** — `pnpm lint && npx tsc --noEmit`. Expected: 0 errors and no `alert(` remaining: `grep -n "alert(" src/components/Chat.tsx` returns nothing.
- [ ] **Step 3: Commit** — `git add src/components/Chat.tsx` then `git commit -m "feat(ui): inline PT-BR upload-error banner, drop blocking alert()"`

---

### Task 8.11: `not-found.tsx` (404) + loading skeletons for `/` and `/projects/[id]`

**Files:**
- Create: `src/app/not-found.tsx`
- Create: `src/app/loading.tsx`
- Create: `src/app/projects/[id]/loading.tsx`

No custom 404 (default Next page, EN) and no `loading.tsx` anywhere — navigation shows a blank flash. The `/projects/[id]/page.tsx` calls `notFound()` for non-owned/missing projects (and Phase 1 adds a uuid guard), so a PT-BR `not-found.tsx` is the rendered fallback.

- [ ] **Step 1: Create 404** — `src/app/not-found.tsx`:

```tsx
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-gray-600">
        O projeto ou a página que você procura não existe (ou não é sua).
      </p>
      <Link href="/" className="bg-black text-white rounded px-4 py-2 min-h-11">
        Voltar para meus projetos
      </Link>
    </main>
  )
}
```

- [ ] **Step 2: Create home skeleton** — `src/app/loading.tsx` (mirrors `page.tsx`'s `max-w-3xl mx-auto p-8` shell):

```tsx
export default function Loading() {
  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6 animate-pulse" aria-busy="true" aria-label="Carregando">
      <div className="flex items-baseline justify-between">
        <div className="h-7 w-40 rounded bg-gray-200" />
        <div className="h-4 w-32 rounded bg-gray-200" />
      </div>
      <div className="flex gap-2">
        <div className="h-11 flex-1 rounded bg-gray-200" />
        <div className="h-11 w-20 rounded bg-gray-200" />
      </div>
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-16 rounded border bg-gray-100" />
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Create project skeleton** — `src/app/projects/[id]/loading.tsx` (mirrors the workspace `grid-cols-[420px_1fr]` shell, responsive per Phase 1's `flex flex-col lg:grid`):

```tsx
export default function Loading() {
  return (
    <main className="h-screen flex flex-col lg:grid lg:grid-cols-[420px_1fr] animate-pulse" aria-busy="true" aria-label="Carregando projeto">
      <aside className="border-r flex flex-col gap-3 p-4">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="h-20 rounded bg-gray-100" />
        <div className="h-20 rounded bg-gray-100" />
      </aside>
      <section className="bg-gray-50" />
    </main>
  )
}
```

- [ ] **Step 4: Verify** — `pnpm build && pnpm start`; `curl -s localhost:3000/projects/not-a-uuid` (after auth) renders "Página não encontrada", and `curl -s -o /dev/null -w '%{http_code}' localhost:3000/projects/00000000-0000-0000-0000-000000000000` → `404`. Skeletons confirmed in the navigation snapshot (Task 8.13).
- [ ] **Step 5: Commit** — `git add src/app/not-found.tsx src/app/loading.tsx src/app/projects/[id]/loading.tsx` then `git commit -m "feat(ui): PT-BR 404 page + route loading skeletons"`

---

### Task 8.12: MeshViewer spinner overlay during worker hydration

**Files:**
- Modify: `src/components/MeshViewer.tsx:91-104,200-201`
- Modify: `src/components/ProjectWorkspace.tsx:296-307`

While the jscad/STL worker hydrates the mesh, `positions` is `null` and the viewer shows an empty grid with no feedback. Add a `loading` prop to `MeshViewer` and overlay a spinner; `ProjectWorkspace` derives it from "an iteration is selected but no positions yet, and no error".

- [ ] **Step 1: Implement the prop** — `src/components/MeshViewer.tsx`. Add `loading?: boolean` to `MeshViewerProps` (after `pickMarker`, line 103):

```tsx
  /** When true, overlay a spinner while the mesh worker is hydrating. */
  loading?: boolean
```

Destructure it (line 155-164 param list) and wrap the return in a relative container with the overlay (the `<Canvas>` already fills its parent). Replace the top-level `return (<Canvas …>` with:

```tsx
  return (
    <div className="relative h-full w-full">
      {loading && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <span className="flex items-center gap-2 text-sm text-gray-700">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
            Gerando visualização…
          </span>
        </div>
      )}
      <Canvas
        camera={{ position: [80, 80, 80], fov: 40 }}
        aria-label="Visualização 3D do modelo. Arraste para girar, role para dar zoom."
        role="img"
        fallback={<span>Visualização 3D indisponível neste navegador.</span>}
      >
```

…and add the matching closing `</div>` after `</Canvas>` (line 245).

- [ ] **Step 2: Implement the derived flag** — `src/components/ProjectWorkspace.tsx`. Add a `hydrating` state set true at the start of each worker run and false on settle. Minimal approach: a `const [hydrating, setHydrating] = useState(false)` near the other state (after line 54), set `setHydrating(true)` before `runInWorker(...)` and `setHydrating(false)` in the surrounding `finally`/after `setPositions` in `onResult`, the mount effect, and `onMeshUploaded`. Pass it to the viewer (:297-307):

```tsx
        <MeshViewer
          ref={meshViewerRef}
          positions={positions}
          bodies={bodies}
          fitKey={iterationId ?? undefined}
          bodyColor={bodyColor}
          logoColor={logoColor}
          pickMode={pickMode}
          onPick={(point, normal) => setPick({ point, normal })}
          pickMarker={pick?.point ?? null}
          loading={hydrating}
        />
```

- [ ] **Step 3: Verify** — `pnpm lint && npx tsc --noEmit`. Expected: 0 errors. Visually: a project load shows the "Gerando visualização…" overlay until the mesh appears (confirm in the manual viewport check of Task 8.13).
- [ ] **Step 4: Commit** — `git add src/components/MeshViewer.tsx src/components/ProjectWorkspace.tsx` then `git commit -m "feat(ui): mesh-viewer hydration spinner overlay"`

---

### Task 8.13: Playwright snapshot guard — 390×844 + 1440×900, no-EN-leak assertion

**Files:**
- Test: `tests/e2e/ux-polish.spec.ts` (create)

The audit acceptance is "mobile (390px) + desktop snapshots clean; no EN leaks in PT-BR UI; a11y spot-check". Encode it as a Playwright spec that runs at both viewports against the test-login session helper (`tests/e2e/session-helper.ts`, already used by other specs).

- [ ] **Step 1: Write the spec** — `tests/e2e/ux-polish.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// No EN leak: these scaffold/EN strings must not appear anywhere in the PT-BR UI.
const FORBIDDEN_EN = [
  'Your projects', 'New project title', 'No projects yet',
  'Sign in', 'Send magic link', 'Describe what to build',
  'Slice for printing', 'Download .3mf', 'Print time', 'Filament',
  'Generating', 'Create Next App', 'Generated by create next app',
]

for (const vp of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const) {
  test(`sign-in: PT-BR, labelled, no EN leak (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/sign-in')
    await expect(page.locator('h1')).toContainText('Entrar')
    await expect(page.getByLabel('E-mail')).toBeVisible()
    const html = await page.content()
    for (const en of FORBIDDEN_EN) expect(html).not.toContain(en)
  })

  test(`page metadata is PT-BR, lang=pt-BR (${vp.name})`, async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page).toHaveTitle(/Gerador 3D/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  })
}
```

(Workspace-level snapshots that need a seeded project use the existing `session-helper.ts` login + a generative-flow mock; reuse the pattern from `tests/e2e/generative-flow.spec.ts`. Keep this spec to the auth-free `/sign-in` surface plus the metadata/lang guard so it runs without DB seeding; the overlap/contrast probes from Tasks 8.7/8.9 attach to the existing workspace specs.)

- [ ] **Step 2: Run to verify it fails first** — `pnpm test:e2e tests/e2e/ux-polish.spec.ts` BEFORE the copy tasks land (or stash them) — Expected: FAIL on `toContainText('Entrar')` / forbidden-string assertions while EN strings remain.
- [ ] **Step 3: Run to verify it passes** — after Tasks 8.2–8.8 are merged: `pnpm test:e2e tests/e2e/ux-polish.spec.ts` — Expected: PASS at both viewports.
- [ ] **Step 4: Commit** — `git add tests/e2e/ux-polish.spec.ts` then `git commit -m "test(e2e): PT-BR no-EN-leak + a11y + metadata snapshot guard at 390/1440"`

---

### Task 8.14: Auto-name project from first prompt — pure `deriveProjectTitle` helper

**Files:**
- Create: `src/lib/projects/derive-title.ts`
- Modify: `src/actions/projects.ts:11`
- Test: `tests/unit/derive-title.test.ts`

`createProject` (actions/projects.ts:11) defaults to the EN literal `'Untitled project'` when no title is typed. The polish goal is to auto-name from the first prompt — but `createProject` only receives the title form field, not a prompt. The cleanest unit-testable piece is a pure helper that turns a free-text prompt (or empty) into a sensible PT-BR title; the generate route (Phase 3 territory) can later call it to rename `'Projeto sem título'` projects on first prompt. Here we (a) extract the helper, (b) swap the EN default to PT-BR.

- [ ] **Step 1: Write the failing test** — `tests/unit/derive-title.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveProjectTitle } from '@/lib/projects/derive-title'

describe('deriveProjectTitle', () => {
  it('falls back to a PT-BR default for empty input', () => {
    expect(deriveProjectTitle('')).toBe('Projeto sem título')
    expect(deriveProjectTitle('   ')).toBe('Projeto sem título')
  })

  it('takes the first line, trimmed and collapsed', () => {
    expect(deriveProjectTitle('  porta-lata cilíndrico\nsegunda linha ')).toBe('porta-lata cilíndrico')
  })

  it('truncates long prompts to 60 chars with an ellipsis', () => {
    const long = 'a'.repeat(80)
    const out = deriveProjectTitle(long)
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
  })

  it('strips an "(image only)" placeholder prompt', () => {
    expect(deriveProjectTitle('(image only)')).toBe('Projeto sem título')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/derive-title.test.ts` — Expected: FAIL (module `@/lib/projects/derive-title` does not exist).
- [ ] **Step 3: Implement** — create `src/lib/projects/derive-title.ts`:

```ts
const DEFAULT_TITLE = 'Projeto sem título'
const MAX_LEN = 60

/**
 * Turn a user's first prompt into a short, PT-BR project title.
 * Pure + side-effect free so it's reused by both the create action and the
 * generate route's first-prompt rename. Empty/placeholder prompts → default.
 */
export function deriveProjectTitle(prompt: string | null | undefined): string {
  const firstLine = (prompt ?? '').split('\n')[0].replace(/\s+/g, ' ').trim()
  if (!firstLine || firstLine === '(image only)') return DEFAULT_TITLE
  if (firstLine.length <= MAX_LEN) return firstLine
  return firstLine.slice(0, MAX_LEN).trimEnd() + '…'
}
```

Then swap the default in `src/actions/projects.ts:11`:
```ts
  const title = String(formData.get('title') ?? '').trim() || 'Projeto sem título'
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/derive-title.test.ts` — Expected: PASS (4/4).
- [ ] **Step 5: Commit** — `git add src/lib/projects/derive-title.ts src/actions/projects.ts tests/unit/derive-title.test.ts` then `git commit -m "feat(ui): deriveProjectTitle helper + PT-BR default project name"`

---

### Task 8.15: Simple pagination of the project list — pure `paginate` helper

**Files:**
- Create: `src/lib/projects/paginate.ts`
- Modify: `src/app/page.tsx:8,12-17,45-57`
- Test: `tests/unit/paginate.test.ts`

`Home` (page.tsx:12-17) selects ALL of the user's projects (the audit notes 98 rows) and renders every one — no pagination. Add a pure offset/limit helper, then drive the home query/render from a `?page=` search param with prev/next links.

- [ ] **Step 1: Write the failing test** — `tests/unit/paginate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { paginate, PAGE_SIZE } from '@/lib/projects/paginate'

describe('paginate', () => {
  it('defaults to page 1, offset 0', () => {
    expect(paginate(undefined, 100)).toMatchObject({ page: 1, offset: 0, limit: PAGE_SIZE, hasPrev: false, hasNext: true })
  })

  it('clamps non-numeric / out-of-range page to 1', () => {
    expect(paginate('abc', 100).page).toBe(1)
    expect(paginate('0', 100).page).toBe(1)
    expect(paginate('-5', 100).page).toBe(1)
  })

  it('computes offset and hasNext/hasPrev', () => {
    const p = paginate('2', 100)
    expect(p).toMatchObject({ page: 2, offset: PAGE_SIZE, hasPrev: true, hasNext: true })
  })

  it('hasNext is false on the last page', () => {
    const total = PAGE_SIZE + 1
    const last = paginate('2', total)
    expect(last.hasNext).toBe(false)
    expect(last.hasPrev).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test tests/unit/paginate.test.ts` — Expected: FAIL (module does not exist).
- [ ] **Step 3: Implement** — create `src/lib/projects/paginate.ts`:

```ts
export const PAGE_SIZE = 20

export type Pagination = {
  page: number
  offset: number
  limit: number
  hasPrev: boolean
  hasNext: boolean
}

/** Parse a `?page=` value (string | string[] | undefined) against a known total. */
export function paginate(raw: string | string[] | undefined, total: number): Pagination {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '', 10)
  const page = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
  const offset = (page - 1) * PAGE_SIZE
  return {
    page,
    offset,
    limit: PAGE_SIZE,
    hasPrev: page > 1,
    hasNext: offset + PAGE_SIZE < total,
  }
}
```

Wire it into `src/app/page.tsx`. Accept `searchParams`, count the user's projects, then `limit`/`offset` the select and add prev/next links:

```tsx
import { count } from 'drizzle-orm'
import { paginate } from '@/lib/projects/paginate'
// …
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) return null
  const { page: pageParam } = await searchParams

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
  const pg = paginate(pageParam, total)

  const myProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))
    .limit(pg.limit)
    .offset(pg.offset)
```

Add the nav below the `<ul>` (after line 57):
```tsx
      {(pg.hasPrev || pg.hasNext) && (
        <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
          {pg.hasPrev ? (
            <Link href={`/?page=${pg.page - 1}`} className="text-gray-600 hover:underline min-h-11 flex items-center">
              ← Anteriores
            </Link>
          ) : <span />}
          <span className="text-gray-500">Página {pg.page}</span>
          {pg.hasNext ? (
            <Link href={`/?page=${pg.page + 1}`} className="text-gray-600 hover:underline min-h-11 flex items-center">
              Próximos →
            </Link>
          ) : <span />}
        </nav>
      )}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test tests/unit/paginate.test.ts` — Expected: PASS (4/4). Also `npx tsc --noEmit` to confirm the `count`/`searchParams` wiring types.
- [ ] **Step 5: Commit** — `git add src/lib/projects/paginate.ts src/app/page.tsx tests/unit/paginate.test.ts` then `git commit -m "feat(ui): paginate the project list (20/page) with PT-BR prev/next"`

---

### Task 8.16: Phase-8 gate — full local suite + dual-viewport snapshot

**Files:**
- (no code change — verification only)

- [ ] **Step 1: Run the gate** — `pnpm lint && npx tsc --noEmit && pnpm test && pnpm test:e2e` (e2e against `:3001` per Phase 2). Expected: lint 0/0, tsc 0, vitest all-green incl. the two new helper specs, e2e green incl. `ux-polish.spec.ts` at both viewports.
- [ ] **Step 2: EN-leak grep** — `grep -rnE "Your projects|New project title|No projects yet|Sign in|Send magic link|Describe what to build|Slice for printing|Download \.3mf|Print time|Filament|Generating…|Create Next App" src/app src/components` — Expected: no matches (all swept to PT-BR).
- [ ] **Step 3: Prod-build smoke** — `pnpm build && pnpm start`; confirm `/sign-in` title is `Gerador 3D`, `lang="pt-BR"`, dark-mode OS setting does not invert the page, and a bad-uuid `/projects/...` renders the PT-BR 404. Expected: all pass.
- [ ] **Step 4: Commit (if any snapshot baselines were generated)** — `git add tests/e2e/**/*-snapshots/** 2>/dev/null; git commit -m "test(e2e): commit Phase 8 snapshot baselines" || true` (skip if Playwright produced none).

---

## Phase 9 — Final gate + integration (GATE 2)

### Task 9.1: Full local gate, then hand off to finishing-a-development-branch

This is the terminal task. It runs the complete gate and then invokes `/finishing-a-development-branch` — it does NOT push or open a PR. The push/PR decision is GATE 2, owned by the operator inside that skill.

**Files:** (verification only — no code change)

- [ ] **Step 1: Lint** — `pnpm lint` — Expected: 0 errors, 0 warnings.
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` — Expected: 0 errors.
- [ ] **Step 3: Unit suite** — `pnpm test` — Expected: all pass (≥175, the count grows as tasks add tests), 0 fail.
- [ ] **Step 4: Coverage gate** — `pnpm test --coverage` — Expected: meets the thresholds set in Task 2.9.
- [ ] **Step 5: E2E** — `E2E_BASE_URL=http://localhost:3001 pnpm test:e2e` against a fresh `pnpm build && PORT=3001 pnpm start` — Expected: 5/5 green.
- [ ] **Step 6: Prod-build auth smoke** — re-run the Task 1.3 probes against the prod server — Expected: unauth `/` → 307 /sign-in, authed `/` renders the project list.
- [ ] **Step 7: Hand off** — invoke `/finishing-a-development-branch`. Do NOT run `git push` or `gh pr create` here — that skill presents GATE 2 and the operator decides.
