---
uid: task-054
status: done
priority: normal
scheduled: 2026-06-12
completed: 2026-08-06
pomodoros: 0
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Audit v1 closeout: merge PR #8, deploy migration 0005 + backfill 5.5, browser follow-ups, 6.6

Closeout of the audit-v1 remediation arc (PR #8, branch `feat/audit-v1-remediation`).
All steps below are **human-gated** (merge / production deploy) — do not automate.

## Status update (2026-06-12)
CI on PR #8 is now **green** (was red — verified green only locally before).
Fixes landed on the branch (commits `7015d18`, `19889eb`):
- quality lane: added a Postgres service + `db:migrate` (3 integration suites need a real DB),
  raised Vitest timeouts (manifold WASM), removed a dev-machine-path debug harness,
  fixed the imported-flow db mock.
- e2e lane: test-login now sets a bare http cookie so the prod-build e2e authenticates
  (verified 10/10 against a local `next start` over http). Was masked because e2e
  `needs: quality`, which had always failed first.

## Subtasks
- [ ] Merge PR #8 → main (GATE 2 — human decision; CI is green)
- [ ] Deploy: apply migration `0005` + run backfill 5.5 in prod (NOT applied to dev `app`)
- [ ] Browser follow-ups: verify CSP / referrer / keyboard checks against the deploy
- [ ] 6.6 — split `extrudeLogo` (deferred; gate on a golden test first)

## Notes
- Migration 0005 was generated + verified on a scratch DB only; CI now also applies it
  on its ephemeral Postgres each run, so it's continuously smoke-tested.

## Related

- [[sprint]] - Current sprint
- [[activeContext]] - Active context
