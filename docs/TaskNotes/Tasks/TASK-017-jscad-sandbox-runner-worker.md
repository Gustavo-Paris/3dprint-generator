---
uid: task-017
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# JSCAD sandbox + runner + worker

**Files:** `src/lib/jscad/sandbox.ts`, `src/lib/jscad/runner.ts`, `src/lib/jscad/worker-entry.ts`, `src/lib/jscad/worker-client.ts`, `tests/unit/jscad-runner.test.ts`

**Security note (repeat from header — read again before implementing):**

This task introduces the file that **compiles model-generated JavaScript at runtime**. That is the explicit purpose of this product, not an accidental code injection. The threat model is documented in the plan header. The sandbox is implemented in `sandbox.ts` and that file is the **only** place in the codebase allowed to invoke the dynamic-code constructor. Treat it as a security-sensitive module: any change there should be reviewed by a second pair of eyes.

- [ ] **Step 1: Failing test for the pure runner**

`tests/unit/jscad-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runJscad } from '@/lib/jscad/runner'

describe('runJscad', () => {
  it('returns triangle positions for a cuboid', async () => {
    const code = `
      const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] })
      module.exports = { main }
    `
    const r = await runJscad(code)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.positions.length).toBeGreaterThan(0)
      expect(r.positions.length % 9).toBe(0)
      expect(r.triangleCount).toBeGreaterThan(0)
    }
  })

  it('reports a syntax error cleanly', async () => {
    const r = await runJscad('this is not (valid javascript')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toMatch(/syntax|unexpected/)
  })

  it('rejects code that does not export main()', async () => {
    const r = await runJscad('module.exports = {}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toContain('main')
  })

  it('rejects code whose main() returns a non-geometry value', async () => {
    const r = await runJscad('const main = () => 42; module.exports = { main }')
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Implement the sandbox (single source of dynamic compilation)**

`src/lib/jscad/sandbox.ts`:

```ts
/**
 * SECURITY-CRITICAL FILE
 *
 * Purpose: compile a string of model-generated JavaScript into a callable
 * function. This is the ONLY place in the codebase allowed to do dynamic
 * code compilation. All other code paths must go through compileUserModule().
 *
 * Threat model:
 *   - Runs inside a dedicated Web Worker (no DOM, no document, no window).
 *   - Caller is an allowlisted, authenticated user. There is no public signup.
 *   - The output is a Float32Array of vertex positions — no objects, no callbacks.
 *   - The Worker does not import network APIs from this file; the system prompt
 *     forbids fetch/XHR usage and the runner does not pass any network globals.
 *
 * Hardening backlog (Phase 5):
 *   - Move into an OffscreenCanvas iframe with a strict CSP that disables fetch.
 *   - Or swap for an SES (Hardened JavaScript) realm.
 */

type UserModule = { main?: () => unknown }

/**
 * Compile a JavaScript source string into a function that, when called with
 * the jscad namespace, returns its module.exports object.
 *
 * The returned function takes (jscad, module, exports) as parameters and
 * the body is the user's code followed by `return module.exports`. This is
 * equivalent to a function expression — JavaScript's standard mechanism for
 * turning a string into a callable.
 */
export function compileUserModule(
  source: string,
): (jscad: unknown) => UserModule {
  const FunctionCtor = (function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown

  const compiled = new FunctionCtor(
    'jscad',
    'module',
    'exports',
    `${source}\nreturn module.exports;`,
  )

  return (jscad: unknown) => {
    const exportsObj: UserModule = {}
    const moduleObj = { exports: exportsObj }
    return compiled(jscad, moduleObj, exportsObj) as UserModule
  }
}
```

- [ ] **Step 3: Implement the runner**

`src/lib/jscad/runner.ts`:

```ts
import * as jscadModeling from '@jscad/modeling'
import { compileUserModule } from './sandbox'

export type JscadResult =
  | { ok: true; positions: Float32Array; triangleCount: number }
  | { ok: false; error: string }

export async function runJscad(code: string): Promise<JscadResult> {
  let mod: { main?: () => unknown }
  try {
    const factory = compileUserModule(code)
    mod = factory(jscadModeling)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  if (typeof mod?.main !== 'function') {
    return {
      ok: false,
      error: 'Code must export a main() function via module.exports = { main }.',
    }
  }

  let geom: unknown
  try {
    geom = mod.main()
  } catch (e) {
    return { ok: false, error: `main() threw: ${(e as Error).message}` }
  }

  try {
    const { toPolygons } = jscadModeling.geometries.geom3
    const polygons = toPolygons(geom as Parameters<typeof toPolygons>[0])
    if (!Array.isArray(polygons) || polygons.length === 0) {
      return { ok: false, error: 'main() returned no geometry.' }
    }

    const positions: number[] = []
    for (const poly of polygons) {
      const verts = poly.vertices
      // Fan-triangulate the convex polygon.
      for (let i = 1; i < verts.length - 1; i++) {
        positions.push(...verts[0], ...verts[i], ...verts[i + 1])
      }
    }
    return {
      ok: true,
      positions: new Float32Array(positions),
      triangleCount: positions.length / 9,
    }
  } catch (e) {
    return {
      ok: false,
      error: `main() did not return a 3D geometry (geom3). ${(e as Error).message}`,
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/unit/jscad-runner.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Worker entry + main-thread client**

`src/lib/jscad/worker-entry.ts`:

```ts
import { runJscad } from './runner'

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const result = await runJscad(e.data.code)
  ;(self as unknown as Worker).postMessage(result)
}
```

`src/lib/jscad/worker-client.ts`:

```ts
import type { JscadResult } from './runner'

type Job = { resolve: (r: JscadResult) => void; reject: (e: unknown) => void }

let worker: Worker | null = null
let pending: Job | null = null

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
  }
  return worker
}

export function runInWorker(code: string): Promise<JscadResult> {
  if (pending) return Promise.reject(new Error('Another job is in flight'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    ensureWorker().postMessage({ code })
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/jscad/ tests/unit/jscad-runner.test.ts
git commit -m "feat(jscad): sandboxed worker that runs LLM code → mesh"
```
