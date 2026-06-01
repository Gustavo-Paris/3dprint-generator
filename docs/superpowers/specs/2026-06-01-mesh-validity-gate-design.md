# Mesh-validity gate (advisory) — design

**Task:** TASK-050 · Roadmap Fase C ("gate de validade de malha — manifold + parede mínima, com aviso ao usuário")
**Date:** 2026-06-01
**Status:** approved (design)

## Goal

Warn the user, *before* slicing, when the mesh currently in the viewer is not
watertight/manifold — the conditions a slicer (OrcaSlicer) chokes on. **Advisory
only:** the warning never blocks slicing.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Where the check runs | **Client worker** | The worker already parses geometry into `positions`; computing there shows the warning before the user clicks Slice, with no round-trip. Matches existing architecture. |
| v1 scope | **Manifold/watertight only** | Cheap, reliable, and exactly what slicers reject. Min-wall-thickness needs expensive SDF/ray-cast + a printer-specific threshold → deferred to phase 2. |
| Gate behavior | **Advisory (non-blocking)** | Matches the roadmap's "com aviso ao usuário". Slice stays enabled. |

## Architecture

```
load mesh (mount / upload / generate / flexify)
   └─ runInWorker({type:'stl'|'jscad'}) ──► worker-entry
         └─ positions: Float32Array (triangle soup)
               └─ analyzeMeshValidity(positions) ──► MeshValidityReport
         result.validity ─────────────────────────────┐
   ProjectWorkspace.onResult / hydration effects ◄─────┘
         setValidity(report)
               └─ <MeshValidityBanner report={validity} />  (advisory, viewer overlay)
```

### Unit 1 — `src/lib/mesh/validity.ts` (pure, node-testable)

```ts
export type MeshValidityReport = {
  triangleCount: number
  boundaryEdges: number       // open edges (holes) → not watertight
  nonManifoldEdges: number    // edges shared by >2 triangles
  degenerateTriangles: number // zero-area (two welded vertices coincide)
  watertight: boolean         // boundaryEdges === 0 && nonManifoldEdges === 0
}

export function analyzeMeshValidity(
  positions: Float32Array,
  opts?: { weldTolerance?: number },
): MeshValidityReport
```

**Algorithm:**
1. Weld vertices by quantized position (default tol `1e-4`, same as `repair-mesh`)
   → map each of the 3 vertices/triangle to an integer id.
2. For each triangle, emit its 3 edges as sorted `(min,max)` id pairs. A triangle
   with any repeated id is **degenerate** (skip its edges, count it).
3. Tally edge incidence: `==1` boundary, `==2` manifold, `>2` non-manifold.
4. `watertight = boundaryEdges === 0 && nonManifoldEdges === 0`.

Pure function, no THREE dependency (raw Float32Array in, plain object out) → fast
unit tests in the node vitest env. O(triangles) with a Map.

> **Multi-body note:** runs on the merged `positions`. A flexi's articulated
> pieces are spatially separated, so their vertices don't weld across the joint
> gaps — each closed shell contributes 0 boundary edges, so a healthy multi-body
> flexi reports `watertight: true`.

### Unit 2 — worker wiring (`runner.ts` + `worker-entry.ts`)

- Extend the `ok: true` branch of `JscadResult` with `validity?: MeshValidityReport`.
- In `worker-entry.ts`, after `positions` is built (both the `jscad` and the
  `stl`/`3mf` paths), call `analyzeMeshValidity(positions)` and attach it.
- `runJscad` in `runner.ts` likewise attaches validity to its result so the
  parametric path reports too (single call site if computed in worker-entry; the
  jscad result flows through worker-entry, so attaching once in worker-entry
  covers both — confirm during impl and avoid double-compute).

### Unit 3 — state + UI (`ProjectWorkspace.tsx` + `src/components/MeshValidityBanner.tsx`)

- New state `const [validity, setValidity] = useState<MeshValidityReport | null>(null)`.
- Set `setValidity(result.validity ?? null)` wherever a successful worker result is
  consumed: the mount hydration effect, `onMeshUploaded`, and `onResult` (all three
  already branch on `result.ok`). Clear to `null` on error/no-mesh.
- New component `MeshValidityBanner`:
  - Renders `null` when `report` is null or `report.watertight`.
  - Else an **amber advisory banner** in the viewer overlay (sibling of the existing
    red error banner), listing the non-zero issue counts. Slice button untouched.
  - Copy (PT-BR): `⚠ Malha não-estanque — pode falhar ou imprimir com defeitos.`
    followed by the counts present, e.g. `12 arestas não-manifold · 3 buracos · 2 triângulos degenerados`.

## Build sequence (TDD)

1. **Red→Green:** `tests/unit/mesh/validity.test.ts` + `src/lib/mesh/validity.ts`
   - closed tetrahedron (4 faces) → `watertight: true`, all counts 0
   - tetrahedron missing one face → `boundaryEdges > 0`, `watertight: false`
   - 3 triangles sharing one edge → `nonManifoldEdges >= 1`
   - a triangle with two identical vertices → `degenerateTriangles >= 1`
2. Wire `validity` through `JscadResult` + `worker-entry.ts` (+ confirm jscad path).
3. `MeshValidityBanner.tsx` + state in `ProjectWorkspace.tsx` (3 set sites).
4. Verify: `tsc` clean · new files lint-clean · full suite green.
5. Adversarial review workflow over the diff → fix confirmed findings.
6. Commit (explicit staging, Co-Authored-By trailer) → PR.

## Acceptance criteria

- [ ] `analyzeMeshValidity` correctly classifies watertight, holed, non-manifold, and degenerate meshes (unit-tested).
- [ ] A non-watertight mesh in the viewer shows the advisory banner with accurate counts.
- [ ] A watertight mesh (incl. a healthy multi-body flexi) shows no banner.
- [ ] The Slice button remains enabled regardless of validity (advisory).
- [ ] `tsc` clean, new files lint-clean, full test suite green.

## Out of scope (v1)

- Min wall-thickness analysis (phase 2 — needs SDF/ray-cast + printer threshold).
- Server-side revalidation in `/api/slice`.
- Hard-blocking or soft-block (confirm-to-proceed) behavior.
