---
uid: task-012
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

# JSCAD system prompt + tests

**Files:** `src/lib/prompt/system.ts`, `tests/unit/prompt-build.test.ts` (partial)

- [ ] **Step 1: Failing tests**

`tests/unit/prompt-build.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from '@/lib/prompt/system'

describe('SYSTEM_PROMPT (Phase 1: single-body)', () => {
  it('declares mm as the unit', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('mm')
  })
  it('mandates a main() function with single-body return', () => {
    expect(SYSTEM_PROMPT).toMatch(/main\s*\(\s*\)/)
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('return')
  })
  it('references @jscad/modeling', () => {
    expect(SYSTEM_PROMPT).toContain('@jscad/modeling')
  })
  it('forbids non-JSCAD imports', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/(no|only).*(import|require)/)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/prompt-build.test.ts
```

Expected: cannot find module.

- [ ] **Step 3: Implement**

`src/lib/prompt/system.ts`:

```ts
export const SYSTEM_PROMPT = `You generate 3D models as JavaScript code using @jscad/modeling.

RULES
- Units are millimeters (mm). Always.
- Output a CommonJS module with a single function: main()
- main() must RETURN a JSCAD geometry value (a 3D shape from @jscad/modeling). Do not console.log, do not return undefined, do not return an array (Phase 1 is single-body only).
- Do not import or require anything. Only use the global "jscad" namespace which is provided at runtime with the full @jscad/modeling API.
- Use only primitive geometry functions and standard operations on jscad. Examples: jscad.primitives.cuboid, jscad.primitives.cylinder, jscad.primitives.sphere, jscad.transforms.translate, jscad.transforms.rotate, jscad.booleans.union, jscad.booleans.subtract.
- Geometry must be watertight.
- Keep dimensions reasonable for a desktop FDM printer: nothing larger than 200mm in any axis unless explicitly asked.

OUTPUT FORMAT
Return ONLY the JavaScript code, no markdown fences, no commentary. The runtime evaluates the code and expects module.exports.main to exist.

EXAMPLE — user: "a 40mm cube with a 10mm hole through the center"

const main = () => {
  const block = jscad.primitives.cuboid({ size: [40, 40, 40] })
  const hole = jscad.primitives.cylinder({ radius: 5, height: 50 })
  return jscad.booleans.subtract(block, hole)
}
module.exports = { main }
`
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/unit/prompt-build.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt/system.ts tests/unit/prompt-build.test.ts
git commit -m "feat(prompt): JSCAD system prompt for single-body generation"
```
