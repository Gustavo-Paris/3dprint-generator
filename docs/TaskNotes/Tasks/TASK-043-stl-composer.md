---
uid: task-043
status: open
priority: normal
scheduled: 2026-05-16
pomodoros: 0
contexts:
- phase:7
- image
- trophy
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# STL composer

**Files:** `src/lib/compose/stl-compose.ts`, `tests/unit/stl-compose.test.ts`

Place mesh A (the logo, from Meshy) on top of mesh B (the base). This is NOT real CSG union — it's just "concatenate two binary STLs with mesh A offset by Z = base height". The slicer will handle the merge as long as both meshes overlap slightly at the seam (which we ensure with 0.5mm overlap).

```ts
export function composeOnTop(input: {
  top: Uint8Array       // The logo mesh from Meshy
  base: Uint8Array      // The parametric trophy base
  baseHeight: number    // Height of the base — used to offset the top
  scaleTopTo: number    // Target XY dimension for the top piece, in mm
}): Uint8Array {
  // Parse top STL, compute bbox, scale uniformly so max(bbox.x, bbox.y) = scaleTopTo
  // Translate so it sits with min.z at (baseHeight - 0.5), overlap 0.5mm into base
  // Re-serialize together with the base STL
  // ...
}
```

Implementation outline:
1. Parse top STL: read triangle count, extract vertices.
2. Compute bbox of top piece.
3. Compute scale = `scaleTopTo / max(bbox.x, bbox.y)`.
4. Compute translation: center XY at origin; min.z = `baseHeight - 0.5`.
5. Transform every vertex of the top.
6. Concatenate triangles: base triangles + transformed-top triangles.
7. Output binary STL with combined count.

Tests:
- Compose 1-triangle top with 1-triangle base → 2-triangle combined STL with correct offsets.
- Verify bbox of result.

Commit: `feat(compose): stack top mesh on top of base via STL concatenation + scale/translate`.
