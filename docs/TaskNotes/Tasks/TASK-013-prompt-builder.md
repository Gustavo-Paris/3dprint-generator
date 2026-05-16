---
uid: task-013
status: done
priority: normal
scheduled: 2026-05-15
completed: 2026-05-15
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

# Prompt builder

**Files:** `src/lib/prompt/build.ts`, `tests/unit/prompt-build.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/prompt-build.test.ts`:

```ts
import { buildMessages } from '@/lib/prompt/build'

describe('buildMessages', () => {
  it('starts with the system prompt', () => {
    const msgs = buildMessages({ history: [], newMessage: 'a cube' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('@jscad/modeling')
  })

  it('appends history alternating user/assistant', () => {
    const msgs = buildMessages({
      history: [
        { userMessage: 'cube', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,10]}); module.exports = { main }' },
        { userMessage: 'taller', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,30]}); module.exports = { main }' },
      ],
      newMessage: 'add a hole',
    })
    expect(msgs).toHaveLength(6)
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'cube' })
    expect(msgs[2].role).toBe('assistant')
    expect(msgs[2].content).toContain('cuboid')
    expect(msgs[5]).toMatchObject({ role: 'user', content: 'add a hole' })
  })

  it('caps history at the last 10 turns', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      userMessage: `msg ${i}`,
      jscadCode: `// code ${i}`,
    }))
    const msgs = buildMessages({ history, newMessage: 'next' })
    expect(msgs).toHaveLength(22)
    expect(msgs[1].content).toBe('msg 10')
  })
})
```

- [ ] **Step 2: Implement**

`src/lib/prompt/build.ts`:

```ts
import { SYSTEM_PROMPT } from './system'

export type HistoryTurn = {
  userMessage: string
  jscadCode: string | null
}

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

const MAX_HISTORY_TURNS = 10

export function buildMessages(input: {
  history: HistoryTurn[]
  newMessage: string
}): Message[] {
  const recent = input.history.slice(-MAX_HISTORY_TURNS)
  const msgs: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of recent) {
    msgs.push({ role: 'user', content: turn.userMessage })
    if (turn.jscadCode !== null) {
      msgs.push({ role: 'assistant', content: turn.jscadCode })
    }
  }
  msgs.push({ role: 'user', content: input.newMessage })
  return msgs
}
```

- [ ] **Step 3: Run, expect pass**

```bash
pnpm test tests/unit/prompt-build.test.ts
```

Expected: 7 passed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompt/build.ts tests/unit/prompt-build.test.ts
git commit -m "feat(prompt): buildMessages with history cap"
```
