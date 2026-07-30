# Plan — text-to-cad Hybrid Strategy + Multicolor Bridge

Spec: `docs/superpowers/specs/text-to-cad-hybrid-bridge.md`
Pin: `~/www/text-to-cad` @ `64badd1` (Publish 0.3.10).

## Task 1 — M0 bootstrap (outside app repo)

- [x] `uv venv --python 3.12` at `~/www/text-to-cad/.venv`; `uv pip install -e skills/cad/scripts/packages/cadpy` + `playwright` + chromium.
- [x] Install skills for Claude Code (`claude plugin marketplace add` + `install cad@text-to-cad`, or `scripts/install/install-skills.sh`).
- [x] Smoke: benchmark 01 calibration block via `scripts/step`, assert dimensions via `scripts/inspect`, PNG via `scripts/snapshot`.
- Gate: STEP + `.step.glb` + PNG exist; measured dims == benchmark table.

## Task 2 — M1 workshop + first part (outside app repo)

- [x] `~/www/cad-workshop` git init; `AGENTS.md` (H2D conventions, venv path, REPO_ROOT lesson, migrated 3MF/logo lessons); `.gitignore`.
- [x] OrcaSlicer cask installed; `$gcode` discover finds it.
- [x] Part `parts/fillet-bracket`: build123d bracket, selective fillets + 2x M3 counterbore; validate via inspect (hole Ø, cb Ø/depth, fillet radius).
- [x] Slice locally with wrapper-profile JSON (native H2D/X1C profile base); `validate` green.
- Gate: `.gcode` exists + validator passes; committed in cad-workshop.

## Task 3 — merge-lite fixture (app repo, TDD red)

- [x] Generate REAL fixture: 2-body assembly via cadpy `scripts/step --3mf` → copy to `tests/fixtures/3mf/` (small).
- [x] Red tests in `src/lib/import/parse-3mf.test.ts` (or existing test file location): component resolution, transform application, color preservation, cycle guard.

## Task 4 — merge-lite implementation (app repo, TDD green)

- [x] `parse-3mf.ts`: parse `<components><component objectid transform>`, recursive resolve + 4x3 row-major transform compose, per-object color carry, cycle/depth guard.
- [x] Full gate: `pnpm test` (all suites) + `npx tsc --noEmit`.
- Gate: new tests green, zero regressions.

## Task 5 — M2 bridge e2e (app running locally)

- [x] Docker postgres up + dev login (memory `3dprint-dev-setup`).
- [x] Upload cadpy assembly 3MF via Studio; verify both bodies render.
- [x] Paint two colors; export Bambu 3MF.
- [x] Programmatic check of export: `m:colorgroup`, welded vertices, body count ≥ 2.
- Gate: structural check script green.

## Task 6 — M3 LAN dry-run (no physical start)

- [x] Probe printer on LAN; if reachable: `$bambu-labs` config + status + dry-run payload (NEVER `--execute`).
- [x] Else: runbook `docs/` in cad-workshop for the operator.

## Task 7 — wrap-up

- [x] Update auto-memories (decision executed state; workshop setup).
- [x] Final local gate on app repo; STOP at `/finishing-a-development-branch` — push/PR is GATE 2, operator's call. NEVER bake `git push`.
