---
uid: task-034
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-05-16
pomodoros: 0
contexts:
- phase:6
- meshy
- hybrid
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Worker accepts STL input

**Files:** `src/lib/jscad/runner.ts`, `src/lib/jscad/worker-entry.ts`, `src/lib/jscad/worker-client.ts`, `tests/unit/stl-parser.test.ts`

The worker currently takes `{ code: string }` and produces positions + STL. For the generative path we already HAVE the STL — we just need positions for the viewer.

- [ ] **Step 1: Failing test** — `tests/unit/stl-parser.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseBinarySTL } from '@/lib/jscad/runner'

describe('parseBinarySTL', () => {
  it('extracts triangle positions from binary STL', () => {
    // Build a tiny binary STL with one triangle: (0,0,0)-(1,0,0)-(0,1,0)
    const buf = new ArrayBuffer(84 + 50)
    const dv = new DataView(buf)
    dv.setUint32(80, 1, true)
    const base = 84
    // normal (zeros are fine for this test)
    // vertices
    dv.setFloat32(base + 12, 0, true); dv.setFloat32(base + 16, 0, true); dv.setFloat32(base + 20, 0, true)
    dv.setFloat32(base + 24, 1, true); dv.setFloat32(base + 28, 0, true); dv.setFloat32(base + 32, 0, true)
    dv.setFloat32(base + 36, 0, true); dv.setFloat32(base + 40, 1, true); dv.setFloat32(base + 44, 0, true)
    const stl = new Uint8Array(buf)

    const positions = parseBinarySTL(stl)
    expect(positions.length).toBe(9)
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })
})
```

- [ ] **Step 2: Export `parseBinarySTL` from runner.ts**

Add to `src/lib/jscad/runner.ts`:

```ts
export function parseBinarySTL(stl: Uint8Array): Float32Array {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const triCount = dv.getUint32(80, true)
  const positions = new Float32Array(triCount * 9)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(base + 12 + v * 4, true)
    }
  }
  return positions
}
```

- [ ] **Step 3: Extend `JscadResult` shape** in `runner.ts`:

The existing type already has `positions + stl`. For STL input, we want a function that just returns positions. Add a separate helper but the existing `runJscad` signature stays the same.

- [ ] **Step 4: Update worker entry** — `src/lib/jscad/worker-entry.ts`:

```ts
import { runJscad, parseBinarySTL } from './runner'

type Input =
  | { type: 'jscad'; code: string }
  | { type: 'stl'; stl: Uint8Array }

self.onmessage = async (e: MessageEvent<Input>) => {
  const msg = e.data
  if (msg.type === 'jscad') {
    const result = await runJscad(msg.code)
    ;(self as unknown as Worker).postMessage(result)
    return
  }
  if (msg.type === 'stl') {
    try {
      const positions = parseBinarySTL(msg.stl)
      ;(self as unknown as Worker).postMessage({
        ok: true,
        positions,
        triangleCount: positions.length / 9,
        stl: msg.stl,
      })
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ ok: false, error: String(err) })
    }
  }
}
```

- [ ] **Step 5: Update worker-client.ts**

```ts
import type { JscadResult } from './runner'

type Input = { type: 'jscad'; code: string } | { type: 'stl'; stl: Uint8Array }

let worker: Worker | null = null
let pending: { resolve: (r: JscadResult) => void; reject: (e: unknown) => void } | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<JscadResult>) => {
    pending?.resolve(e.data)
    pending = null
  }
  worker.onerror = (e) => {
    pending?.reject(e)
    pending = null
    worker?.terminate()
    worker = null
  }
  return worker
}

export function runInWorker(input: Input): Promise<JscadResult> {
  if (pending) return Promise.reject(new Error('Another job is in flight'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    ensureWorker().postMessage(input)
  })
}
```

- [ ] **Step 6: Run + commit**

```bash
pnpm test tests/unit/stl-parser.test.ts
pnpm tsc --noEmit
git add src/lib/jscad/ tests/unit/stl-parser.test.ts
git commit -m "feat(worker): accept binary STL input + parseBinarySTL helper"
```
