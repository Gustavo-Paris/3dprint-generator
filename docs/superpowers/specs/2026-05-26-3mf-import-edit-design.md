# 3MF Import & Edit — Design Spec

**Date:** 2026-05-26
**Status:** Draft — pending user review
**Author:** brainstorming session (gustavoparis + Claude Opus)

## Problem

Today, the system only generates 3D models from scratch via a parametric LLM pipeline. Users cannot upload an existing `.3mf` (e.g. a box, a bracket, a plaque) and ask the system to **edit** it — add a logo, drill holes, scale a region, emboss text.

This spec defines a new "import & edit" mode that integrates with the existing chat-based iteration flow.

## Goals

- User uploads a `.3mf` and continues chatting in natural language to modify it ("add my logo to the lid", "drill two M3 holes in the corners").
- Edits are applied by an LLM that combines **structured ops** (a catalog of safe, validated operations) with a **JSCAD escape hatch** for cases the catalog doesn't cover.
- Face targeting is **hybrid**: free text by default; when ambiguous, the system renders a numbered-faces preview and asks the user to disambiguate.
- Iterations are chained — the user keeps editing in the same chat, each iteration re-applies the full edit list against the original base mesh (idempotent).
- MVP focuses on **CAD-like geometries** (boxes, brackets, plates). Organic/sculpted meshes are V2.

## Non-Goals

- Mesh-to-CAD reverse engineering (no BREP reconstruction).
- Procedural texture editing.
- Multi-mesh assembly composition (only single-3MF in/out for MVP, though internal extruder labels are preserved).
- Real-time WebGL editing — all edits happen server-side, viewer just renders results.

## Decisions Locked During Brainstorm

| # | Decision | Rationale |
|---|---|---|
| 1 | Full "AI does the heavy lifting" ambition | User explicit: time isn't the constraint |
| 2 | Face targeting: hybrid text → numbered-faces clarify when ambiguous | Covers ~80% in pure text, escape hatch for the rest |
| 3 | LLM output: structured ops catalog + `jscad_raw` escape | Safe by default, powerful when needed |
| 4 | UX: integrated into existing chat / iteration flow | Reuse `ProjectWorkspace`, `iterations` table, `MeshViewer` |
| 5 | MVP scope: CAD-like geometries; organic later | Face segmentation works on flat-ish models |

## Architecture

A new `kind: "imported"` variant is added to the existing `Design` discriminated union. The `/api/generate` route remains the single entry point; it branches internally based on whether the active iteration is associated with an imported base mesh.

```
ProjectWorkspace (UI)
  ├─ Chat (attach .3mf like any other file)
  └─ MeshViewer (already renders 3MF, no change)
        ↓
/api/generate (existing route)
  ├─ If iteration carries baseMeshUrl  ──► branch IMPORTED
  └─ Else                               ──► branch GENERATIVE (current)
        ↓
parseDesign (LLM)
  ├─ kind === "imported" → parseImportEdit
  │     inputs:  base mesh metadata (bbox, segmented faces, multi-angle render)
  │     output:  Design { kind: "imported", baseMeshUrl, edits: Op[] }
  └─ other kinds → existing parseDesign
        ↓
generateFromDesign
  ├─ kind === "imported" → loadBaseMesh + applyEdits + repairMesh
  └─ other kinds → existing parametric generator
        ↓
serialize3mf (or STL) → blob → iteration row (same pattern as today)
```

## Components

### New modules (all under `src/lib/import/`)

| File | Responsibility |
|---|---|
| `load-base-mesh.ts` | Fetch `.3mf` blob, parse via existing `parse3mf`, compute normals + bbox. Preserve per-triangle extruder labels for multi-material round-trip. |
| `face-segment.ts` | Group adjacent triangles whose normals differ < 5°. Return top-12 semantic faces by area (LLM context budget). Each face: `{ id, normal, centroid, area, bboxOnPlane, triangleIndices[] }`. |
| `render-preview.ts` (client-side, in `MeshViewer`) | Captures 4 angle screenshots (top / front / right / iso) from the existing Three.js viewer canvas via `canvas.toDataURL()`. Returns 4 data URLs included in the `/api/generate` request body. Server never renders — sidesteps headless-render dependencies on Vercel. |
| `face-disambiguate.ts` | When LLM responds "ambiguous", render iso-view with each candidate face painted in a distinct color + large number overlay. Returns single PNG. |
| `apply-edits.ts` | Iterate over `edits[]`, dispatch each op to its handler. Returns `{ result: Mesh, warnings: string[] }`. |
| `ops/` directory | Op catalog. Each file exports `{ schema: ZodSchema, apply: (mesh, params, ctx) => mesh }`. |

### Op catalog (MVP)

| Op | Purpose | Notes |
|---|---|---|
| `add_logo` | Extrude an image (provided via attached `imageUrl`) at height `h` mm, boolean-union with mesh at chosen face + 2D offset. | Reuses existing `logo-extrude` pipeline. |
| `hole` | Subtract a cylinder or rectangular prism through a face. Supports `through` or fixed depth. | Multiple positions in one op (array of `[x, y]` on face plane). |
| `scale` | Uniform or per-axis scale. | Applied to the whole mesh; can be limited to a sub-region via JSCAD escape if needed. |
| `emboss_text` | Extruded text glyphs, union or subtraction on chosen face. | Uses a default font; configurable in V2. |
| `jscad_raw` | LLM-authored JSCAD snippet executed in the existing sandbox worker. | 30s timeout; runtime exceptions become warnings (op skipped). |

V2 (deferred): `fillet_edge`, `chamfer`, `shell` (hollow out), `pattern_array`.

### Modifications to existing code

| File | Change |
|---|---|
| `src/lib/design/schema.ts` | Add `imported` variant to the discriminated `Design` union. |
| `src/lib/design/parse.ts` | Route to `parseImportEdit` when context carries `baseMeshUrl`. |
| `src/lib/design/generate.ts` | Branch on `kind === "imported"` → call `applyEdits`. |
| `src/app/api/generate/route.ts` | Detect `.3mf` mesh attachment / history; populate `baseMeshUrl` in iteration context. |
| `src/app/api/upload/route.ts` | Accept `.3mf` MIME type in addition to images. |

## Data Flow (End-to-End Example)

**Scenario:** user uploads `caixa.3mf` and `logo.png`, asks "adiciona meu logo na tampa e faz dois furos M3 nos cantos da base".

1. **Upload** — UI `<input accept=".3mf,.png,.jpg" />` → `POST /api/upload` (multipart) → blob put → returns `{ type, url }`.
2. **First message** — `POST /api/generate` body `{ projectId, message, meshUrl, imageUrl }`.
3. **Routing** — Route detects `meshUrl` → branch IMPORTED. Loads in parallel:
   - `baseMesh = loadBaseMesh(meshUrl)` (~200 ms for 5 MB mesh)
   - `faces = segmentFaces(baseMesh)` (~500 ms)
   - `previews = renderPreviews(baseMesh)` (~1–2 s, 4 angles)
   - `logoBuffer = fetch(imageUrl)`
   - Caches `faces` + `previews` on `iteration.validationReport` for reuse by future iterations.
4. **LLM parse** — `parseImportEdit({ messages, previews, faces, previousDesign, logoAspect })` returns:
   ```json
   {
     "kind": "imported",
     "baseMeshUrl": "...",
     "edits": [
       { "op": "add_logo", "face": 0, "imageUrl": "...", "sizeMm": 30, "depthMm": 0.6 },
       { "op": "hole", "face": 1, "shape": "circle", "diameterMm": 3.2,
         "depthMm": "through", "positions": [[-30, -30], [30, 30]] }
     ]
   }
   ```
5. **Apply edits** — `applyEdits` iterates ops, dispatches handlers; final mesh runs through existing `repairMesh`.
6. **Serialize** — multi-extruder → `serialize3mf(bodies)`; single body → STL. Persist to blob.
7. **Respond** — `{ strategy: "imported", iteration_id, mesh_url, design, meta: { editsApplied, warnings, bbox_mm } }`.
8. **Next iteration** ("deixa os furos um pouco mais pra dentro") — history carries previous `Design`. LLM patches `edits[1].positions`. `applyEdits` re-runs **entire** edit list against original `baseMesh` (idempotent — prevents non-manifold accumulation).

### Key invariants

- **Idempotency:** every iteration rebuilds from `baseMesh` + full `edits[]`. No incremental diff over the previously generated mesh.
- **Extruder preservation:** when the base mesh carries per-triangle extruder labels (A/B), `applyEdits` propagates them to unmodified triangles. Geometry added by an edit inherits the extruder of the host face by default; a future `extruder` field on each op can override this. Resulting mesh serializes as multi-body 3MF iff ≥2 distinct extruders are present, else as STL.
- **Cache:** `faces` and `previews` are computed once per base mesh, persisted in `iteration.validationReport`, reused as long as `baseMeshUrl` is stable.
- **Ambiguity loop:** if `parseImportEdit` returns `{ ambiguous: { question, candidates } }` instead of `edits`, the route responds `status: "needs_clarification"` with a numbered-faces PNG. UI displays it. User reply ("face 2") becomes context for the next call.
- **Partial failure:** if an op handler throws, it logs a warning and is skipped; other ops still run. Returned `meta.warnings[]` carries human-readable reasons.

## Error Handling

| Failure | Origin | Handling |
|---|---|---|
| Corrupted `.3mf` | upload | Reject at `/api/upload` with clear message. |
| Mesh > 50 MB | upload | Reject; suggest reducing resolution. |
| `parseImportEdit` returns malformed JSON | LLM | Retry once with the validation error in the prompt. If still bad, mark iteration `failed` with visible error. |
| LLM returns `ambiguous` | LLM (intentional) | Route responds `status: needs_clarification` + numbered PNG; UI re-asks. |
| `add_logo` on a curved face | op handler | Warning emitted; op skipped; other ops continue. |
| `hole` position outside face bbox | op handler | Clamp to face bbox + warning. |
| `jscad_raw` timeout (>30 s) | sandbox | Abort worker; mark op `failed`; continue with other ops. |
| `jscad_raw` runtime exception | sandbox | Catch → warning → op skipped. |
| `applyEdits` produces non-manifold mesh | apply pipeline | `repairMesh` attempts fix; if still bad, retry once dropping the last applied op. |
| All ops fail | apply pipeline | Iteration `failed`, error lists every attempted op + reason. |
| Render preview fails | render-preview | Continue without preview; LLM works from bbox + face list only (graceful degradation). |
| Face segmentation returns 0 faces (highly organic mesh) | face-segment | Continue without faces; LLM works from preview + bbox; user forced to either click-to-target (via disambiguate) or use `jscad_raw`. |

**Principle 1:** Fail **partially** when possible. If 3 of 4 edits succeed, return the mesh with warnings — user decides whether to accept or refine.

**Principle 2:** Every op failure feeds back into LLM context. The next iteration's history includes "tried `add_logo` on face 0 but it was curved — failed". The LLM learns and proposes a different approach.

## Testing Strategy

### Unit (Vitest)

- `face-segment.test.ts` — fixtures of known meshes (cube, cylinder, staircase, prism) → assert face counts and normals.
- `apply-edits.test.ts` — each op handler with mocked input + reference mesh → validate resulting bbox + volume within tolerance.
- `parse-import.test.ts` — schema validation, parsing of mocked LLM responses, ambiguous branch.
- `load-base-mesh.test.ts` — valid + malformed `.3mf` fixtures.

### Integration (Vitest + mocked LLM)

- Extend `api-generate.test.ts` with cases: upload `.3mf` → first edit → second edit → assert expected diff.
- LLM mocked to return deterministic responses (avoid cost / flakiness).

### E2E (manual playground)

- Curated set of 5–10 real meshes (box, L-bracket, drilled plate, simple vase, etc.) + realistic prompts.
- Run manually before ship to calibrate LLM quality; document outcomes in `docs/reports/`.

### Not tested

- Exact pixel output of previews (fragile, low value).
- Exact geometry produced by `jscad_raw` — only that it executes and doesn't break the pipeline.

### Minimum coverage to merge

All op handlers + face-segment + schema parsing. Render and live LLM call get smoke tests only.

## Open Questions (Track During Implementation)

1. **Preview renderer choice** — Three.js + node-canvas vs reusing existing JSCAD worker. Both viable; pick the simpler one once we measure render time.
2. **Face segmentation tolerance** — 5° normal threshold is a starting guess. Calibrate against the E2E mesh set.
3. **`jscad_raw` sandbox isolation** — confirm the existing sandbox in `src/lib/jscad/sandbox.ts` is safe enough for LLM-authored code or if we need a stricter VM (vm2-like). Probably safe since input is already structurally constrained; verify before relying on it in production.

## Out of Scope (Explicit)

- File formats other than `.3mf` (no STL / OBJ / STEP input for MVP).
- Editing multi-part 3MF assemblies where parts move independently.
- Undo at the op level beyond what chat history already provides.
- Visual edit preview before commit ("dry run" mode).

## Success Criteria

- User uploads a `.3mf`, asks for a logo + holes in natural language, gets a printable mesh back in ≤ 30 s.
- ≥ 80% of "simple CAD" prompts succeed end-to-end without falling back to `jscad_raw`.
- Failures degrade gracefully — partial mesh + warnings, never silent corruption.
- Multi-iteration chat works: each turn refines previous edits without accumulating geometry errors.
