---
uid: task-042
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

# Trophy base builder (parametric JSCAD)

**Files:** `src/lib/compose/trophy-base.ts`, `tests/unit/trophy-base.test.ts`

```ts
// trophy-base.ts — runs server-side, no DOM
import * as jscad from '@jscad/modeling'
const { primitives, transforms, booleans, geometries, hulls } = jscad

export type BaseSpec = {
  /** Top diameter — should match the logo's max XY dimension * 1.2 */
  topDiameter: number
  /** Bottom diameter — typically 1.4× the top for a stable tapered base */
  bottomDiameter: number
  /** Total height in mm */
  height: number
}

export function buildTrophyBase(spec: BaseSpec): Uint8Array {
  const seg = 64
  // Bottom cylinder (wider)
  const bottom = primitives.cylinder({
    radius: spec.bottomDiameter / 2,
    height: spec.height * 0.3,
    segments: seg,
  })
  // Middle taper — use hull between two flat circles? simpler: stacked cylinders for now
  const middle = transforms.translate(
    [0, 0, spec.height * 0.3],
    primitives.cylinderElliptic({
      startRadius: [spec.bottomDiameter / 2, spec.bottomDiameter / 2],
      endRadius: [spec.topDiameter / 2, spec.topDiameter / 2],
      height: spec.height * 0.5,
      segments: seg,
    }),
  )
  // Top platform (where the logo will sit)
  const top = transforms.translate(
    [0, 0, spec.height * 0.8],
    primitives.cylinder({
      radius: spec.topDiameter / 2,
      height: spec.height * 0.2,
      segments: seg,
    }),
  )
  const base = booleans.union(bottom, middle, top)
  return geometryToBinarySTL(base)
}

function geometryToBinarySTL(geom: unknown): Uint8Array {
  const { toPolygons } = geometries.geom3
  const polygons = toPolygons(geom as Parameters<typeof toPolygons>[0])
  const positions: number[] = []
  for (const poly of polygons) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      positions.push(...verts[0], ...verts[i], ...verts[i + 1])
    }
  }
  // ... binary STL serialization (reuse serializeBinarySTL from runner.ts — extract to shared util)
  // (See note: refactor to share with src/lib/jscad/runner.ts's serializer)
  throw new Error('extract serializeBinarySTL helper first — see Task 5 step 1')
}
```

**Refactor first**: extract `serializeBinarySTL` from `src/lib/jscad/runner.ts` into a new `src/lib/stl/serialize.ts`, re-export. Use it from both runner.ts and trophy-base.ts.

Tests:
- `buildTrophyBase({ topDiameter: 60, bottomDiameter: 80, height: 30 })` produces non-empty STL with > 0 triangles and reasonable bbox (max ~40mm radius, height ~30mm).

Commit: `feat(compose): parametric trophy base builder + STL serializer shared util`.
