# Spec — text-to-cad Hybrid Strategy + Multicolor Bridge (merge-lite)

Date: 2026-07-30
Objective: free-text `/goal` (no roadmap id)
Design source: cross-analysis workflow verdict (8 agents, 2026-07-30) + operator approval in-session ("faça acontecer"). Durable record: auto-memory `text-to-cad-hybrid-decision.md`.

## Context

[earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) is an agent-skills
library (MIT) whose engine is `cadpy` (Python, build123d/OCCT): real BREP, STEP-first,
deterministic inspect/measure/diff, headless snapshot, repair-loop. It complements this
app exactly where each is weak:

- Their 3MF export uses core-spec `basematerials` without vertex welding — the two
  Bambu gotchas this app already solved (`m:colorgroup` + weld).
- This app has no BREP kernel — no selective fillets, threads, toleranced holes,
  assemblies. Mesh-CSG (JSCAD + Manifold) is a structural ceiling.

Chosen strategy (scored 35.5/40 vs adopt 23, merge 18, reference 34): **hybrid**.
The mechanical rail lives in Claude Code (skills + `~/www/cad-workshop`); the app stays
alive as the paint/multicolor/organics product; the bridge is `scripts/step --3mf` →
Studio upload → re-serialization with the correct colorgroup+weld serializer → paint →
print. The only app-side code change is **merge-lite**: teach `parse-3mf.ts` to read
`<component>` refs + 3D transforms so cadpy assemblies survive the bridge without being
fused into a single compound (originally gated to 2026-10-28; operator pulled it
forward: "tudo, mas tudo mesmo funcionando").

## Loop contract

### spec

1. **M0 — mechanical rail bootstrap.** Durable clone of text-to-cad at release 0.3.10
   in `~/www/text-to-cad`; skills installed for Claude Code; `uv` venv (Python 3.12 —
   system 3.14 is incompatible with cadquery-ocp) with `cadpy` editable + Playwright
   Chromium; benchmark 01 (calibration block) runs end-to-end: `scripts/step` →
   `scripts/inspect refs --facts` → `scripts/snapshot`.
2. **M1 — workshop + first impossible-in-app part.** `~/www/cad-workshop` git repo
   (one dir per part, AGENTS.md with H2D conventions + migrated lessons
   `3mf-bambu-multicolor` and `logo-relief-on-heavy-meshes`); OrcaSlicer installed
   locally (native ARM); a bracket with selective fillets + M3 counterbore holes
   modeled in build123d, validated via inspect/measure, sliced LOCALLY via the
   `$gcode` skill with a wrapper-profile JSON over native printer profiles.
3. **Merge-lite (app).** `src/lib/import/parse-3mf.ts` parses 3MF `<component>`
   object composition with `transform` matrices (3MF spec 3D row-major 4x3),
   recursively resolving refs, applying transforms to vertices, preserving
   per-object colors. Fixture = a REAL 2+ body assembly 3MF produced by cadpy.
4. **M2 — bridge validated end-to-end.** App running locally; cadpy assembly 3MF
   uploaded through the Studio; painted (two colors); exported via the Bambu
   serializer; exported file verified programmatically: `m:colorgroup` present,
   welded vertices, multi-body geometry preserved.
5. **M3 — LAN handoff dry-run only.** `$bambu-labs` configured up to the dry-run
   payload if the printer is reachable; otherwise a written runbook. Physical print
   start is the operator's.

### done (external rulers)

- M0: benchmark 01 produces a valid STEP + topology GLB + PNG snapshot; dimensions
  asserted via `scripts/inspect` match the benchmark table.
- M1: `gcode_tool.py slice` produces `.gcode` locally and `validate` passes
  (bounds/backend checks green). No Railway involvement.
- Merge-lite: new Vitest cases (component refs, transforms, color preservation,
  recursion guard) green against the REAL cadpy fixture; full `pnpm test` suite
  green; `npx tsc --noEmit` green.
- M2: exported 3MF passes a programmatic structural check (colorgroup + weld +
  body count) — script or test, not eyeballing.
- M3: dry-run JSON payload produced without error, or runbook committed.

### don't

- Never run `$bambu-labs` with `--execute` / `--confirm-start-print` (no physical
  print without the operator).
- Do not touch `src/lib/design/generate.ts`, the paint system, auth, or the 3MF
  serializer beyond what the bridge strictly needs (parse side only).
- Do not unpin text-to-cad from 0.3.10 (record the exact commit SHA).
- No prod deploy, no prod migrations, no `--no-verify`, no force-push.
- Do not fabricate printer profiles for `$gcode` — wrapper JSON over native
  profiles only.

## Out of scope

Full cadpy sidecar in the app (rejected by verdict — 23-30 dev-days for a degraded
copy of the interactive loop); Meshy credits (money decision); prod deploy
(pre-existing pending human step); TS assert-harness / golden prompts (optional
backlog).
