# Full System Audit v1 — Spec (GATE 1 approved 2026-06-11)

## Scope

First full audit of 3dprint-generator (no baseline). Repo sha at start: `8671cc4` (main, clean).

## Environment

- **App**: local dev — Docker Postgres (`3dgen-postgres`) + `pnpm dev` on :3000.
- **Auth**: dev test-login (`E2E_ALLOW_TEST_LOGIN=1`, account `gustavo.b.paris@gmail.com`). Local env → no product-metrics exclusion needed.
- **Slicer**: remote Railway instance, **read-only probes** (`/health` + 1-2 real slices).
- No production deploy of the web app exists; nothing in prod is mutated.

## Real-cost budget

- Anthropic parametric generation: **1-2 live runs** in the critical flow.
- Slicer (Railway): 1-2 real slices.
- Meshy freeform: **skipped** (account out of credits, API 402) → listed under "Not measurable today".
- No emails sent (test-login bypasses Resend); no payment surfaces exist.

## Grading

Canonical rubric: per item 0-10, deductions P0 −3+, P1 −1..−2, P2 −0.5.
Area = mean of items; overall = weighted mean. Unmeasurable items excluded, never guessed.

| Area | Weight |
|---|---|
| Architecture & code | 15 |
| Tests & quality gates | 10 |
| Security | 15 |
| Backend/services | 10 |
| Data & domain | 10 |
| Functional flows (live app) | 20 |
| Design & UX | 10 |
| Performance | 10 |

## Layers

0. Prep: sha/versions, graphify run, test infra up, test-login verified.
1. Code analysis: parallel background agents (security, backend, domain, architecture, tests/gates) — text-only findings, file:line evidence, P0/P1/P2.
2. Live app: browser agents (flow-tester, ux-reviewer, perf-auditor) on :3000 — screenshots stay in agents; Lighthouse runs last, alone.
3. Consolidation: merge, grade, report.

Then adversarial verification of the 4-8 most consequential findings (independent re-measurement) before publishing.

## Guardrails

- Read-only on the Railway slicer beyond the budgeted slices.
- Max 1 retry on expensive failures; time every AI/slice stage.
- Record every entity id created locally (cleanup section in report).

## Deliverable

`docs/reviews/2026-06-11-full-system-audit-v1.md` — scorecard, weighted overall, P0/P1/P2 list with evidence, adversarial-verification summary, "Not measurable today", cleanup notes. GATE 2 = push decision.
