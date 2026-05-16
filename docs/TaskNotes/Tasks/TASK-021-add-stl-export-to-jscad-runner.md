---
uid: task-021
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:4
- slicer
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Add STL export to JSCAD runner

**Files:** `src/lib/jscad/runner.ts`, `tests/unit/stl-export.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/stl-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runJscad } from '@/lib/jscad/runner'

describe('runJscad STL export', () => {
  it('produces binary STL bytes for a cuboid', async () => {
    const code = `const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] })\nmodule.exports = { main }`
    const r = await runJscad(code)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.stl).toBeInstanceOf(Uint8Array)
      // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes/triangle.
      // A cube triangulated has 12 triangles → 84 + 50*12 = 684 bytes.
      expect(r.stl.byteLength).toBe(684)
      // First 80 bytes are header text; 4 next are uint32 triangle count = 12
      const dv = new DataView(r.stl.buffer, r.stl.byteOffset, r.stl.byteLength)
      expect(dv.getUint32(80, true)).toBe(12)
    }
  })
})
```

- [ ] **Step 2: Run, expect failure** (TS error: `r.stl` doesn't exist)

```bash
pnpm test tests/unit/stl-export.test.ts
```

- [ ] **Step 3: Extend `JscadResult` and emit STL in `runner.ts`**

Modify `src/lib/jscad/runner.ts`. Replace the `JscadResult` type and the success branch:

```ts
export type JscadResult =
  | { ok: true; positions: Float32Array; triangleCount: number; stl: Uint8Array }
  | { ok: false; error: string }
```

Inside the `try` block right after `triangleCount` is computed, add the STL serialization before `return { ok: true, ... }`:

```ts
    const stl = serializeBinarySTL(positions)
    return {
      ok: true,
      positions: new Float32Array(positions),
      triangleCount: positions.length / 9,
      stl,
    }
```

And add this helper at the bottom of the same file:

```ts
function serializeBinarySTL(positions: number[]): Uint8Array {
  const triCount = positions.length / 9
  const buf = new ArrayBuffer(84 + 50 * triCount)
  const dv = new DataView(buf)
  // Bytes 0–79: header (zeroed) — leave as 0
  dv.setUint32(80, triCount, true)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    const o = i * 9
    // Compute the face normal from the three vertices
    const ax = positions[o + 3] - positions[o]
    const ay = positions[o + 4] - positions[o + 1]
    const az = positions[o + 5] - positions[o + 2]
    const bx = positions[o + 6] - positions[o]
    const by = positions[o + 7] - positions[o + 1]
    const bz = positions[o + 8] - positions[o + 2]
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    dv.setFloat32(base, nx, true)
    dv.setFloat32(base + 4, ny, true)
    dv.setFloat32(base + 8, nz, true)
    for (let v = 0; v < 9; v++) {
      dv.setFloat32(base + 12 + v * 4, positions[o + v], true)
    }
    // attribute byte count = 0 (16-bit at offset base+48)
    dv.setUint16(base + 48, 0, true)
  }
  return new Uint8Array(buf)
}
```

Also: change the `positions: number[]` array used for triangulation to be retained instead of immediately turned into a Float32Array. The simplest approach — keep using `positions` as a `number[]` throughout the inner block, pass it to `serializeBinarySTL(positions)`, then wrap it in `Float32Array` for the return value.

- [ ] **Step 4: Run, expect 1 passed (+ all prior tests still pass)**

```bash
pnpm test tests/unit/stl-export.test.ts
pnpm test  # full suite
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jscad/runner.ts tests/unit/stl-export.test.ts
git commit -m "feat(jscad): export binary STL alongside mesh positions"
```
