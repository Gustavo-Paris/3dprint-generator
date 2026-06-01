# Reliable OrcaSlicer wire + health check — design

**Task:** TASK-051 · Roadmap Fase C ("Wire confiável do serviço OrcaSlicer (SLICER_URL/Railway) + health check")
**Date:** 2026-06-01
**Status:** approved (design)

## Goal

Make slicing reliable and surface slicer availability *proactively*: the user
should know the slicer is offline before clicking Slice, and a hung/down slicer
must fail fast with a clear message instead of hanging to `maxDuration` (180s).

## Current state

- `sliceStl()` (src/lib/slicer/client.ts) POSTs to `${SLICER_URL}/slice` with **no
  timeout**; on non-ok it throws `Slicer ${status}: ${body}`. The `/api/slice`
  route catches → generic 502.
- The slicer service **already exposes `GET /health`** → `{ ok, orca, profiles_dir }`
  (slicer/src/server.ts). The Next app never calls it.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Health posture | **Proactive** — UI checks `/api/slicer-health`, disables Slice + shows "Slicer offline" when down |
| `sliceStl` robustness | **Timeout (120s) + classified errors**, no retry |

## Architecture

```
SliceButton (mount, mesh ready) ──GET /api/slicer-health──► checkSlicerHealth() ──GET ${SLICER_URL}/health
   slicerOk: true → normal · false → disabled + "Slicer offline" note

SliceButton click ──POST /api/slice──► sliceStl() ──POST ${SLICER_URL}/slice (120s AbortController)
   throws SlicerError{kind} → route maps: offline|timeout → 503 · slicer → 502 → SliceButton shows message
```

### Unit 1 — `checkSlicerHealth()` (src/lib/slicer/client.ts)

```ts
export type SlicerHealth = { ok: boolean; orca?: string; profilesDir?: string; error?: string }
export async function checkSlicerHealth(timeoutMs?: number): Promise<SlicerHealth>
```
- GET `${SLICER_URL}/health`, AbortController timeout (default 5000ms).
- **Never throws.** 200 + body.ok → `{ ok: true, orca, profilesDir }`. Otherwise
  `{ ok: false, error }` classified as offline (fetch threw) / timeout (abort) /
  `bad status N`.

### Unit 2 — hardened `sliceStl()` (src/lib/slicer/client.ts)

```ts
export type SlicerErrorKind = 'offline' | 'timeout' | 'slicer'
export class SlicerError extends Error { kind: SlicerErrorKind; status?: number }
```
- AbortController timeout (default 120000ms, < route maxDuration 180s).
- Maps failures: fetch throws → `offline`; AbortError → `timeout`; non-ok
  response → `slicer` (carries `status` + truncated body). No retry.
- Success unchanged: `{ bytes, meta }`.

### Unit 3 — `GET /api/slicer-health` (src/app/api/slicer-health/route.ts)

- `runtime = 'nodejs'`. Requires an authenticated session (401 otherwise).
- Returns `200 { ok, orca?, profilesDir?, error? }` from `checkSlicerHealth()`
  (the `ok` flag lives in the body, not the HTTP status, so the client reads it
  uniformly).

### Unit 4 — `/api/slice` route error mapping

- Replace the generic `catch → 502` with: if `err instanceof SlicerError`, map
  `offline|timeout → 503`, `slicer → 502`; body = `err.message`. Non-SlicerError
  stays 502. (No preflight — posture is proactive UI, not reactive.)

### Unit 5 — `SliceButton` health indicator (src/components/SliceButton.tsx)

- New state `slicerOk: boolean | null` (null = checking).
- `useEffect` on mount (guarded by iterationId && stl): `fetch('/api/slicer-health')`
  → set `slicerOk` from `body.ok`. Best-effort; a failed fetch ⇒ `slicerOk=false`.
- Render: `slicerOk === false` → Slice button `disabled` + a small "Slicer offline"
  note. `null`/`true` → current behaviour (don't block on the in-flight check).
- Slice failure path: surface `err.message` (already does via `setError`).

## Build sequence (TDD)

1. Red→Green: `tests/unit/slicer/client.test.ts` + the two client functions
   (`checkSlicerHealth`, hardened `sliceStl` with `SlicerError`), mocked `fetch`.
2. `GET /api/slicer-health` route.
3. `/api/slice` route error mapping.
4. `SliceButton` health check + disabled/offline UI.
5. Verify: tsc clean · new files lint-clean · full suite green.
6. Smoke: slicer container down → "Slicer offline" + Slice disabled; container up
   → normal. (3dgen-slicer is currently down — offline path testable now.)
7. Adversarial review → fix confirmed findings → commit → PR.

## Acceptance criteria

- [ ] `checkSlicerHealth` never throws; classifies offline/timeout/bad-status (unit-tested).
- [ ] `sliceStl` aborts at 120s and throws `SlicerError` with the right `kind` (unit-tested).
- [ ] `GET /api/slicer-health` requires auth and returns the health body.
- [ ] `/api/slice` maps offline/timeout → 503, slicer → 502.
- [ ] SliceButton disables + shows "Slicer offline" when the slicer is down; normal when up.
- [ ] tsc clean, new files lint-clean, full suite green.

## Out of scope

- Preflight health ping inside `/api/slice` (posture is proactive UI).
- Retries / circuit breaker.
- Changes to the slicer service (its `/health` already exists).
- Periodic/polled health (single check on mount is enough for MVP).
