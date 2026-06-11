# Audit v1 Remediation + Polish — Design

Roadmap: none (free-text /goal arc — "resolva todos os achados, faz a funcionalidade ficar foda")
Source: docs/reviews/2026-06-11-full-system-audit-v1.md (full system audit v1, overall 7.0/10)
Date: 2026-06-11
Base sha: 8671cc4

## Objective

Resolve every audit finding (2 P0, ~18 P1, ~20 P2) and bring the core loop
(generate → preview → slice → export) to a premium feel. No new product
capability — the existing loop becomes correct, trustworthy, and polished. UI
standardized in PT-BR; code/specs/commits stay in English.

## Approach

**Foundation-first (approach A).** Establish the quality gate (CI + green E2E)
early so every later phase is verifiable, then work outward in risk order:
ship-blockers → core-loop correctness → backend/security → data → architecture →
performance → UX polish. Each phase is independently testable and committed
task-by-task.

## Non-goals

- New capabilities (no project sharing, no auth providers beyond the current
  Resend magic-link, no Meshy re-enable — it stays blocked on credits).
- Deletion **UI** (a `del()` blob helper + orphan-sweep script are in scope as
  data hygiene; a user-facing delete flow is deferred — it's a new capability).
- Touching the chassis contracts beyond what a finding requires.

## Environment / verification baseline

- Local dev `:3001` (Docker Postgres `3dgen-postgres`); production build probed
  via `next start` for the auth/perf checks (this is how P0-1 was found —
  `next dev` auto-trusts localhost and hides it).
- Remote Orca slicer on Railway: read-only except budgeted slices.
- Gate set today (all green): `pnpm lint` (0/0), `npx tsc --noEmit` (0), `pnpm test`
  (175 pass / 1 skip). E2E is 2/5 (rotted) and targets `:3000` — fixed in Phase 2.

---

## Phase 0 — Operator actions (Wave 0, not code)

Documented steps for the operator; the arc does not perform these.

- Rotate `AUTH_RESEND_KEY` and `MESHY_API_KEY` (both pasted in chat, flagged for
  rotation; verified absent from git history — out-of-band exposure only).
- Confirm `AUTH_TRUST_HOST=true` (or `AUTH_URL`) in the Railway env. The Phase 1
  code fix (`trustHost: true`) makes this unnecessary, but the env is the belt.

---

## Phase 1 — Ship-blockers (P0)

| Finding | Fix | File(s) |
|---|---|---|
| **P0-1** prod auth broken — `UntrustedHost` on every `auth()` → blank app for everyone (also explains dead middleware) | `trustHost: true` in NextAuth config; auth pages `redirect('/sign-in')` instead of `return null` | `src/auth.ts:12`, `src/app/page.tsx:10`, `src/app/projects/[id]/page.tsx` |
| **P0-2** workspace unusable at 390px — viewer off-screen | responsive: `flex flex-col lg:grid lg:grid-cols-[420px_1fr]` | `src/components/ProjectWorkspace.tsx:281` |
| P1 `/projects/<non-uuid>` → 500 + SQL leak (masked in prod by P0-1; surfaces once auth resolves) | validate `id` with `z.string().uuid()`, `notFound()` on failure before the query | `src/app/projects/[id]/page.tsx:17` |

**Acceptance:** prod-build probe — authed `/` renders the project list (not
byte-identical to logged-out), unauth `/` 307→`/sign-in`, `/projects/not-a-uuid`
→ 404; 390px viewport shows the 3D viewer.

---

## Phase 2 — Quality-gate foundation

| Finding | Fix |
|---|---|
| P1 E2E rotted 3/5 + targets `:3000` | `baseURL`/`webServer` read `E2E_BASE_URL`; update the 3 specs' mocks to the current `/api/generate` contract (with `meta`); guard `Chat.tsx:156` `body.meta?.bbox_mm` |
| P1 no CI | one GitHub Actions workflow: `pnpm lint && npx tsc --noEmit && pnpm test` (+ e2e against a built app) |
| P2 no coverage gate/provider | install `@vitest/coverage-v8`; thresholds for `src/lib/mesh`, `src/lib/flexify`, `src/lib/3mf` |

**Acceptance:** `pnpm test:e2e` 5/5 green against `:3001`; CI green on a push;
`pnpm test --coverage` enforces the threshold.

---

## Phase 3 — Core-loop correctness & trust

| Finding | Fix | File(s) |
|---|---|---|
| P1 slice print-time/filament always "—" | parse the 3MF (`slice_info.config` `prediction`/`used_m` or gcode headers) instead of regex-scraping stdout; surface real values | `slicer/src/server.ts:92-102`, UI `SliceButton.tsx:128,134` (`!= null`) |
| P1 parametric mesh flagged non-watertight ("88 buracos") on a trivial plate | reproduce; fix `flat_plate` builder to emit watertight geometry **or** fix false-positive in the validity checker | `src/lib/mesh/validity.ts`, the parametric builders in `src/lib/design/generate.ts` |
| P1 "Logo aqui" always fails on parametric (raw error + failed row) | hide the entry point unless the project has an imported base mesh | `src/components/ProjectWorkspace.tsx` (logo controls) |
| P1 `/api/slice` no domain preconditions (sets `sliced` from any state, trusts client bytes) | require `status IN ('ready','sliced')`; slice the server-persisted mesh (or verify hash) | `src/app/api/slice/route.ts:14-33` |
| P1/flow failed & stuck render as "Generated"; strategy badge lies ("MESHY" on parametric) | branch UI on `status` (`failed`/`generating`) and surface `iterations.error`; derive badge from `design.kind` not the hardcoded `strategy` | `src/components/ProjectWorkspace.tsx:189-216`, `Chat.tsx:213` |
| P1 magic-link failure invisible when Resend key invalid | render `searchParams.error` on `/sign-in`; catch `AuthError` in the sign-in action | `src/app/sign-in/page.tsx` |
| P2 cached `_previews`/`_faces` stringified into LLM prompts (rows ≤806KB) | strip `_`-prefixed keys before building `previousDesign`; zod-parse on read | `generate/route.ts:210-215,339-342`, `parse-import.ts:60-61` |
| P2 stuck `generating` (4 inert rows, oldest 17d) + no reaper | sweep on `status='generating' AND created_at < now()-15min → failed`; wrap the generate route tail so throw paths write `failed` | `generate/route.ts` tail, new reaper |
| P2 no timeout/abortSignal on LLM calls; single-shot JSON parse | `abortSignal: AbortSignal.timeout(60_000)`; one repair re-ask on schema failure | `parse.ts:65`, `parse-import.ts:88`, `describe-image.ts:34`, `parse.ts:102-117` |

**Acceptance:** unit tests for the 3MF metadata parser, the validity fix, and the
reaper; a smoke run shows real print-time/filament and no false "non-watertight".

---

## Phase 4 — Backend & security hardening

| Finding | Fix |
|---|---|
| P1 inconsistent API error shapes (text vs JSON); internal/LLM text leaks to client | one `apiError(status, code, message)` helper returning JSON everywhere; generic client messages, detail to logs/DB |
| P1 no structured logging (120 `console.*`) | minimal pino (or tagged wrapper) with per-request id in route handlers |
| P1 no CSP/X-Frame-Options/HSTS/nosniff/referrer-policy | `headers()` block in `next.config.ts` |
| P2 SSRF in `/api/generate` via `imageUrl`/`meshUrl` (owner-only today) | mirror flexify's `ownMeshUrls` membership check for `meshUrl`; block private/link-local/metadata ranges for `imageUrl`; add the realpath traversal guard to generate's local-file branches |
| P2 dependency moderates (`postcss <8.5.10`, `phin`) | transitive override in package.json |
| P2 unbounded request bodies (`stlBase64`, `previewDataUrls`) | `.max()` caps matching the 50MB mesh limit |
| P2 upload trusts browser MIME | magic-byte sniff (PNG/JPEG/WebP/ZIP) |
| P2 env access bypasses `src/env.ts` | import `env` everywhere (`MESHY_API_KEY`, BLOB token ×4, `llm/model`, `meshy/client`) |

**Acceptance:** error-shape unit tests; header probe shows CSP/XFO/nosniff; an
SSRF probe with an internal IP is rejected; `pnpm audit --prod` clean of the two
moderates.

---

## Phase 5 — Data & domain integrity (one migration + cleanup)

| Finding | Fix |
|---|---|
| P1 zero indexes on hot paths; unprojected selects pull MBs | index `iterations(project_id, created_at)` + `projects(user_id)`; project columns on history reads |
| P1 no FK on `current_iteration_id`; dead `parent_iteration_id` | FK `ON DELETE SET NULL`; drop `parent_iteration_id` |
| P2 no CHECK/pg-enum on text enums; `timestamp` without tz | CHECK constraints (or pg enums); `timestamptz` |
| P2 13 legacy `ready` rows with NULL mesh (2 unrenderable) | backfill the 2 unrenderable → `failed` |
| P2 no deletion story; 194 orphan files (33MB); blobs write-only | `del()` blob helper + an orphan-sweep script (no UI) |
| P2 `strategy` column drift (always `'generative'`) | write the real design kind |

**Acceptance:** migration replays clean on a truly fresh DB (drop+recreate, not a
reused volume); post-cleanup orphan queries return 0; `EXPLAIN` shows index use
on the project_id/user_id filters.

---

## Phase 6 — Architecture consolidation

| Finding | Fix |
|---|---|
| P1 `persistMesh`/blob-persist duplicated 4× | extract `src/lib/storage/persist.ts`, one blob-or-local helper |
| P1 `extrudeLogo` 535-line god-function | split into per-step functions matching the 9-step header |
| P1 `repair-mesh.ts` (309 ln) production-dead | delete module + its test |
| P1 `makeFrame`/`orientAlongNormal` duplicated (add-logo vs hole) | move both into `ops/_shared.ts` |
| cosmetic (V4 refuted as crash) | use `loadJscad()` in `hole.ts`/`emboss-text.ts`/`jscad-raw.ts` for consistency |
| P2 8 `debug-*` scripts committed in `src/scripts/` | move to gitignored `scripts/debug/` or delete |
| P2 head-swap reachable only via CLI | mark experimental (comment/README) |
| P2 `validationReport` jsonb multi-use with unchecked casts | dedicated typed/zod-parsed cache shape |

**Acceptance:** tsc + full suite green; no behavior change (consolidation only);
`repair-mesh` references gone.

---

## Phase 7 — Performance

| Finding | Fix |
|---|---|
| P1 no `dynamic()` boundary; 928KB three.js+R3F+drei chunk eager | `dynamic(() => import('./MeshViewer'), { ssr:false, loading })`; split drei/controls |
| P2 3MF parse full-buffer regex + per-triangle spread-push | preallocate `Float32Array` (size known after vertex pass), write by index |
| P2 main-thread vertex loop in `MeshViewer` `DynamicGrid` | derive grid size from the already-computed bbox, not a re-scan |

**Acceptance:** workspace transferred JS drops below the current 248KB-gz single
chunk; `/sign-in` Lighthouse stays ~0.98; parse unit test still green.

---

## Phase 8 — UX polish ("foda") + a11y + PT-BR locale

| Finding | Fix |
|---|---|
| P1 dark mode half-implemented (invisible 1.07:1 text) | remove the `@media (prefers-color-scheme: dark)` block until dark mode is designed |
| P1 no loading states anywhere | `loading.tsx` skeletons per route + viewer spinner during worker hydration |
| P1 PT/EN mix on every surface | sweep all UI strings to PT-BR |
| P1 "Create Next App" title sitewide | real `metadata` + per-project `generateMetadata` |
| P1 dev jargon in UI ("Design interpretado pelo LLM", "Editar JSON", raw JSCAD, SLICER_URL) | user-facing labels; env names to logs only |
| P1 a11y: canvas no label, unlabeled inputs, 4 contrast failures, mouse-only flow | `aria-label`+fallback on Canvas; labels on inputs; darken orange-600/emerald-700/gray-500; keyboard path for logo placement (numeric inputs) |
| P1 touch targets <44px | `min-h-11`/padding on interactive elements; ≥44px color pickers |
| P1 SliceButton overlaps color panel | shared top-right flex stack or offset |
| P2 `alert()` for upload errors | inline error banner |
| P2 default Next 404 | `src/app/not-found.tsx` |
| P2 Geist fonts loaded but Arial hardcoded | `font-family: var(--font-sans)` |
| polish | microcopy on the prompt input; auto-name project from first prompt; simple pagination on the 98-project list |

**Acceptance:** mobile (390px) + desktop snapshots clean; no EN leaks in PT-BR
UI; a11y spot-check (labels, contrast, canvas fallback, keyboard); aXe-style
contrast on primary text/buttons passes.

---

## Cross-cutting discipline

- **Commit per task**, verbatim trailer, explicit staging, never `--no-verify`.
- **Checkpoint pauses (inline):** tasks marked `(structural)` — `/api/generate`
  & `/api/slice` response-shape changes, the `apiError` helper, the persist
  helper extraction — and `(destructive)` — deleting `repair-mesh.ts`, the schema
  migration (FK + drop column + enum/tz), moving debug scripts.
- **Final task** stops at the full local gate (tsc + test + e2e + a prod-build
  smoke for the auth fix) and invokes `/finishing-a-development-branch`. No baked
  `git push` — the push/PR is GATE 2.
- Schema migration is **replay-tested on a genuinely fresh DB** before it's
  considered done (beware reused Docker volumes).

## Risks

- **Slice metadata fix lives in `slicer/`** (the Orca microservice, deployed to
  Railway) — fixing it means redeploying that service, not just the Next app.
  The Next-side UI hardening (`!= null`) ships independently.
- **Schema migration** on a DB with live data (90 projects) — the FK add must
  tolerate existing rows (verified 0 violations today, so it will); the column
  drop is irreversible (destructive checkpoint).
- **PT-BR sweep** is broad and touches many components — risk of missing a
  string; the E2E copy assertions (Phase 2) become the guard.
