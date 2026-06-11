# Full System Audit v1 — 3dprint-generator

| | |
|---|---|
| **Date** | 2026-06-11 |
| **Repo sha** | `8671cc4` (main, clean) |
| **Environment** | Local dev `:3001` (Docker Postgres `3dgen-postgres`); remote Orca slicer on Railway probed read-only; production build (`next start`) probed for the auth/perf findings |
| **Account** | `gustavo.b.paris@gmail.com` via dev test-login (local data — no product metrics) |
| **Method** | Layered agents (5 code + 3 live-app + perf) → adversarial verification of 5 top findings → weighted scorecard. No prior baseline. |
| **Live-cost spend** | 1 Anthropic parametric generation, 1 Railway slice, 0 Meshy (out of credits), 0 retries |

## Overall: **7.0 / 10** — with one launch-blocking P0

Strong engineering foundations (0 dependency cycles, clean type/lint gates, real domain tests, hardened `flexify` route, lean public bundle) sitting under a **production-config blocker that makes the deployed app blank for every user**, plus a UX layer that's well behind the code quality. The grade is "good bones, not shippable yet."

### Scorecard

| Area | Weight | Grade | Drivers |
|---|---:|---:|---|
| Architecture & code | 15 | **7.3** | 0 cycles in 334 modules; debt is intra-file (535-line god-function, 4× copy-paste) not structural |
| Tests & quality gates | 10 | **6.2** | lint/tsc/unit all green & rigorous; **no CI**, E2E rotted 3/5, no coverage gate |
| Security | 15 | **8.1** | strong IDOR + secrets hygiene; missing headers/CSP; SSRF (owner-only) |
| Backend / services | 10 | **6.7** | slicer integration mature; no reaper, in-request only, console-soup logging |
| Data & domain | 10 | **6.7** | impeccable pointer integrity by app discipline; 0 DB-level FKs/indexes on hot paths |
| Functional flows (live) | 20 | **7.4** | core loop works end-to-end in dev (gen 1.4s, slice 1.4s); **prod auth P0 gates it** |
| Design & UX | 10 | **4.2** | weakest area: blank logged-out page, mobile-unusable workspace, PT/EN mix, no loading states |
| Performance | 10 | **7.9** | public surface lean (182 KB, LH 0.98); workspace 928 KB 3D chunk, no lazy boundary |

Weighted: `(7.3·15 + 6.2·10 + 8.1·15 + 6.7·10 + 6.7·10 + 7.4·20 + 4.2·10 + 7.9·10) / 100 = 6.96`.

---

## P0 — blockers (fix before any deploy)

### P0-1 · Production auth is broken for everyone — `trustHost` not set
**This is the headline finding and it was missed by every layer agent** (they tested in `next dev`, which auto-trusts localhost). Re-measured on the production build:

- Build emits `ƒ Proxy (Middleware)` — `middleware.ts` *is* compiled and wired (so "Next 16 renamed middleware→proxy / wrong location" is **refuted**).
- Yet `next start` logs `UntrustedHost: Host must be trusted. URL was: …/api/auth/session` on **every request**, in both the edge/proxy chunk and the SSR chunk.
- With a **valid** `__Secure-authjs.session-token`, the authed home page is **byte-identical** to the logged-out one and shows zero projects.
- `trustHost: true` / `AUTH_URL` / `AUTH_TRUST_HOST` appears **nowhere** in `src/`, `.env.local`, or `.env.example`.

NextAuth v5 only auto-trusts the host on Vercel. On Railway (this project's deploy target) every `auth()` call throws `UntrustedHost` → returns a null session → (a) the middleware redirect branch never fires (the "dead middleware" the security agent saw), and (b) every page's server-side `auth()` sees null and renders `return null` → **blank page for logged-in and logged-out users alike**. One root cause behind both the "dead middleware" and "blank page" reports, and more severe than either.

**Fix:** add `trustHost: true` to the NextAuth config in `src/auth.ts` (or set `AUTH_TRUST_HOST=true` in the Railway env and validate it in `src/env.ts`). Also make the auth pages `redirect('/sign-in')` instead of `return null`, so that even with auth working the logged-out experience isn't a blank screen.
*Evidence: prod server stderr; `middleware.ts`; `src/auth.ts:19` (`session.strategy='database'`); `src/app/page.tsx:10`.*

### P0-2 · Workspace unusable on mobile (core screen, 390 px)
`src/components/ProjectWorkspace.tsx:281` uses `grid grid-cols-[420px_1fr]` with no breakpoint. At 390×844 the layout forces a 720 px track and the 3D viewer (`section`, x=420 w=300) renders **entirely off-screen** — the user sees only the chat column, the model is invisible. For a consumer 3D-print app this blocks the entire mobile platform.
**Fix:** stack below `lg:` — `flex flex-col lg:grid lg:grid-cols-[420px_1fr]`.

---

## P1 — major (the "fix-first" set)

**Reliability / correctness**
1. **`/projects/<non-uuid>` → HTTP 500** and leaks the SQL query — raw param hits a uuid column (`src/app/projects/[id]/page.tsx:17`). Currently *masked* in prod by P0-1; surfaces the moment auth is fixed. → validate with `z.string().uuid()` and `notFound()`. *(flow-tester + UX, confirmed by lead: prod returns 200 only because `auth()` is null and the page exits before the query.)*
2. **Slice print-time/filament always shows "—"** despite a successful slice. **Verified service-side:** `slicer/src/server.ts:92-102` regex-scrapes OrcaSlicer **stdout** instead of parsing the 3MF it just wrote; the regex token `print`/`estimated printing` never matches the gcode's `printing time` / `total estimated time`, so it emits `null/null`. The data is present in the artifact (`prediction=691`, `filament used [mm]=2694.38`). Client/route/UI are all correct. → parse `Metadata/slice_info.config` (or the gcode header) in the slicer service. *(V3 partially-confirmed — original "service returns null" was inferred, not measured; mechanism proven.)*
3. **Parametric meshes flagged non-watertight by the app's own validator** — a plain 80×40×4 plate with one hole shows "Malha não-estanque — 88 buracos" (slicer accepted it fine). Either the `flat_plate` builder emits non-watertight geometry or `lib/mesh/validity` false-positives. → reproduce and fix the builder or the checker.
4. **Iterations strand in `generating` forever** — no reaper anywhere; 3 throw paths escape the `failed` write (`generate/route.ts:306-308, :335, :344-353`) plus the process-restart vector. Live DB has 4 stuck rows (oldest 17 d). *Downgraded P1→P2 by verification* (they're inert — no project points at them, no spinner-forever), but listed here because the fix is the same cheap reaper: `status='generating' AND created_at < now()-15min → failed`.
5. **Magic-link failure is invisible** when `AUTH_RESEND_KEY` is invalid (the key is flagged for rotation) — `src/app/sign-in/page.tsx` has no error handling and ignores `?error=`. → render `searchParams.error` + catch `AuthError`.
6. **"Logo aqui" always fails on parametric projects** — the entry point is offered on every mesh but returns a raw `Error: Error: API 400: {json}` and leaves a `failed` iteration row when there's no imported base mesh. → hide the button unless the project has an imported mesh.

**Quality gates**
7. **No CI at all** — `.github/workflows` doesn't exist; a 12-second gate set (lint 3s + tsc 1s + vitest 8s, all currently green) runs nowhere. → one GitHub Actions workflow.
8. **E2E suite rotted** — 3/5 specs fail deterministically (legacy mock shape without `meta` → `Chat.tsx:156` `body.meta.bbox_mm` TypeError; stale copy assertion), and `playwright.config.ts` hardcodes `localhost:3000` + `reuseExistingServer` so `pnpm test:e2e` silently tests a *different project* on this machine. → fix mocks + `E2E_BASE_URL` env.

**Security**
9. **No security headers** — no CSP / X-Frame-Options / HSTS / nosniff / referrer-policy, and no `headers()` in `next.config.ts` (so prod is equally bare). → add a `headers()` block.

**Data & domain**
10. **Zero DB indexes on hot paths** — every page/route filters `iterations.project_id` and `projects.user_id` with only PKs present, and the selects are unprojected so a full history pulls MBs of `validation_report` per request (avg 90 KB, max 806 KB). → index `iterations(project_id, created_at)` + `projects(user_id)`, project columns on reads.
11. **No FK on `projects.current_iteration_id`** — integrity holds only by app discipline (verified 0 violations across 90 projects). → FK `ON DELETE SET NULL`; drop the never-written `parent_iteration_id`.
12. **`/api/slice` has no domain preconditions** — accepts client-supplied `stlBase64`, never checks mesh presence/status, sets `status='sliced'` from any state. → require `status IN ('ready','sliced')` and slice the server-persisted mesh.
13. **Cached previews bloat LLM prompts** — `_previews`/`_faces` (4 PNG data-URLs) stored in `validation_report` are stringified straight into the prompt on every follow-up edit (`parse-import.ts:60-61`), rows up to 806 KB. → strip `_`-prefixed keys before building `previousDesign`.

**Backend hygiene**
14. **Inconsistent API error shapes** (text vs JSON) and **internal error text — including raw LLM output — leaked to the client** (`parse.ts:106-115 → generate/route.ts:287`). → one `apiError()` helper; generic client messages, detail to logs.
15. **No structured logging** — 120 `console.*` calls, no request IDs/durations. → minimal pino + per-request id.

**Architecture (consolidation debt)**
16. `persistMesh`/blob-persist **duplicated 4×**; `extrudeLogo` is a **535-line god-function**; `repair-mesh.ts` (309 lines) is **production-dead**; `makeFrame`/`orientAlongNormal` duplicated. → extract `src/lib/storage/persist.ts`, split `extrudeLogo`, delete dead module, share the ops helpers.

**Performance**
17. **No `dynamic()` boundary for the 3D viewer** — `ProjectWorkspace.tsx:6` statically imports `MeshViewer`; the workspace ships a single **928 KB (248 KB gz) three.js+R3F+drei chunk** eagerly with no Suspense fallback. → `dynamic(() => import('./MeshViewer'), { ssr:false, loading })` + split drei.

**Design & UX** (area is full of P1s — see UX section)
18. Dark mode half-implemented → invisible text (1.07:1 contrast); **no loading states anywhere**; **PT/EN language mix** on every surface; **"Create Next App" title** sitewide; **dev jargon in user UI** ("Design interpretado pelo LLM", "Editar JSON", raw JSCAD); **a11y**: canvas with no label, unlabeled inputs, 4 contrast failures, mouse-only flow; touch targets <44 px.

---

## P2 — polish (selected; full list in raw findings)

- **SSRF in `/api/generate`** via `imageUrl`/`meshUrl` (fetched server-side with no allowlist, unlike `flexify`). *Downgraded P1→P2:* gated behind auth + a tiny owner-only `AUTH_ALLOWED_EMAILS` allowlist — no anonymous path. Becomes P1 if signups open or chained with an auth bypass. → mirror flexify's `ownMeshUrls` check + block private/link-local ranges for `imageUrl`.
- **Compromised keys still live** (`AUTH_RESEND_KEY`, `MESHY_API_KEY`) — verified absent from git history (out-of-band exposure only). → rotate.
- **Dependency moderates** — `phin` SSRF + `postcss <8.5.10` XSS (via `next@16.2.6`); 0 high/critical. → transitive override.
- **No deletion story** — zero `db.delete`/`del()`; 194 unreferenced files (33 MB) in `public/meshes`; blobs are write-only. → delete flow + orphan sweep.
- **No CHECK constraints / `timestamptz`**; **`strategy` column drift** (every insert hardcodes `'generative'`); **`sliced` rows with NULL `sliced_blob_url`** in dev (20/20).
- **No coverage gate/provider**; two weak assertions in `repair-mesh.test.ts`.
- **`alert()` for upload errors**; default Next 404 (no `not-found.tsx`); Geist fonts loaded but Arial hardcoded; 98 projects with no pagination/search; en-US dates.
- **3MF parse** full-buffer regex + per-triangle spread-push (`parse-3mf.ts:73`); main-thread vertex loop in `MeshViewer.tsx:76`; brotli not served by `next start`.
- 8 `debug-*` scripts committed in `src/scripts/`; head-swap pipeline reachable only via CLI.

---

## Adversarial verification (5 findings re-measured from scratch)

| # | Finding | Verdict | Δ |
|---|---|---|---|
| V0 | Dead middleware (sec) vs never-executes (UX) | **Confirmed + escalated** | Unified into **P0-1** (`trustHost`); both agents' root causes were wrong |
| V1 | SSRF in `/api/generate` | **Confirmed** | Severity **P1 → P2** (auth + owner-only allowlist) |
| V2 | Stuck `generating` + no reaper | **Confirmed** | Severity **P1 → P2** (inert rows; doesn't block workspace) |
| V3 | Slice metadata lost | **Partially-confirmed** | Location proven service-side; "returns null" was inferred not measured; **P1 held** |
| V4 | jscad ESM destructure crash | **Refuted** | **P1 → non-issue** — Turbopack `interopEsm` flattens the CJS exports; destructures work |

This is the spread the method expects: one finding sharpened and escalated, two correctly downgraded, one location-corrected, one disproved by the code. The escalation (V0) is the most important outcome of the whole audit.

---

## Not measurable today

- **Whether `AUTH_TRUST_HOST`/`AUTH_URL` is set in the live Railway env** — can't read it from here. If it *is* set out-of-band, prod auth works but the config is undocumented and absent from the repo (still a P1-grade fragility). If not, P0-1 stands as a hard blocker.
- **Meshy / freeform path** — account out of credits (402); wired but not runnable. Graceful degradation verified by code only (unconfigured → 503 friendly; configured-but-402 → 502 raw provider text into chat).
- **Heavy-mesh slice timing** (700k+ tris — the path the 280s timeout targets) and the **full logo-engrave** job — no fixture sliced; auth blocks the upload flow under prod build.
- **Authenticated workspace runtime perf** (LCP/TBT/INP of the 928 KB 3D canvas) — blocked by P0-1.
- **Production response headers / brotli** — only `next start` (gzip) reachable, no live Railway app to probe.
- **Real fresh-DB migration replay** — verified statically (ledger-gated, ordered DDL); today's `db:migrate` "error" was confirmed to be a Postgres `42P07` idempotency NOTICE from drizzle's bootstrap, not a failure.

---

## Cleanup notes (entities created during the audit)

Local dev DB / filesystem only — nothing in production was mutated; the Railway slicer was touched via `GET /health` plus 1 budgeted slice.

- project `b9c75ada-1399-4cb4-8899-3de64d7528c1` ("audit-flow-1781182634974")
- iteration `3669e883-628d-4fd0-9c8d-d791da414f7e` (status `sliced`)
- iteration `11f30c6f-33f0-4f52-89b4-5f20061fe8a8` (status `failed` — logo-place probe)
- file `public/meshes/3669e883-628d-4fd0-9c8d-d791da414f7e.stl` (32 KB)
- a few `gustavo.b.paris@gmail.com` session rows from test-login
- Infra left running by the audit: production server on `:3001` (stop with the PID on `:3001`); `report/` graphify output and `.next/` prod build are gitignored.

To remove the audit's data: `DELETE FROM projects WHERE id='b9c75ada-1399-4cb4-8899-3de64d7528c1';` (cascades to both iterations) and `rm public/meshes/3669e883-628d-4fd0-9c8d-d791da414f7e.stl`.

---

## Recommended fix waves (operator-approved, not auto-started)

- **Wave 0 (operator, ~15 min):** rotate `AUTH_RESEND_KEY` + `MESHY_API_KEY`; set `AUTH_TRUST_HOST=true` (or merge the `trustHost` code fix) and confirm the Railway env.
- **Wave 1 (mechanical P1s, TDD, commit-per-item):** P0-1 code fix + redirect, P0-2 responsive grid, non-uuid 500, slice-metadata service parse, security headers, CI workflow, E2E repair, DB indexes + FK. Each is small and independently testable.
- **Wave 2 (careful):** `/api/slice` preconditions + the validation_report prompt-bloat fix (touches the generate contract — replay-test); consolidation refactors (persist helper, split `extrudeLogo`).
- **UX track (separate arc):** locale sweep, loading states, dark-mode removal, metadata/title, a11y pass — the area is a 4.2 and needs its own focused effort, not scattered fixes.

*Raw per-area agent findings and full adversarial transcripts: `/tmp/audit-v1/*.md` (not committed).*
