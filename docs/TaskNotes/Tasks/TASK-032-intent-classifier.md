---
uid: task-032
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

# Intent classifier

**Files:** `src/lib/prompt/classify.ts`, `tests/unit/classifier.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/classifier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { classifyIntent } from '@/lib/prompt/classify'

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { generateText } from 'ai'

vi.mock('@/lib/llm/model', () => ({
  getClassifierModel: () => 'mocked-model',
}))

describe('classifyIntent', () => {
  it('returns "generative" when classifier responds with g', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'g' })
    const r = await classifyIntent('iron man helmet real size')
    expect(r).toBe('generative')
  })

  it('returns "parametric" when classifier responds with p', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'p' })
    const r = await classifyIntent('a 40mm cube with a 10mm hole')
    expect(r).toBe('parametric')
  })

  it('defaults to parametric on ambiguous output', async () => {
    ;(generateText as any).mockResolvedValueOnce({ text: 'maybe both?' })
    const r = await classifyIntent('something weird')
    expect(r).toBe('parametric')
  })
})
```

- [ ] **Step 2: Implement** — `src/lib/prompt/classify.ts`

```ts
import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'

const CLASSIFIER_PROMPT = `You classify 3D-print requests as either:
- p = parametric/functional/geometric (cubes, brackets, vases, hooks, organizers, tools, anything that can be built from primitives + boolean operations)
- g = generative/figurative/organic (characters, masks, helmets, miniatures, sculptures, animals, anything requiring sculpted free-form surfaces)

Respond with exactly one character: p or g. No explanation.`

export async function classifyIntent(userMessage: string): Promise<'parametric' | 'generative'> {
  try {
    const { text } = await generateText({
      model: getClassifierModel(),
      system: CLASSIFIER_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 4,
    })
    const c = text.trim().toLowerCase().charAt(0)
    return c === 'g' ? 'generative' : 'parametric'
  } catch {
    return 'parametric' // safe fallback
  }
}
```

- [ ] **Step 3: Extend `src/lib/llm/model.ts`** to add `getClassifierModel`:

```ts
// Append to the existing file:
import { anthropic } from '@ai-sdk/anthropic'
import { gateway } from 'ai'

const CLASSIFIER_MODEL_ID = 'claude-haiku-4-5'

export function getClassifierModel(): LanguageModel {
  if (process.env.AI_GATEWAY_API_KEY) return gateway(`anthropic/${CLASSIFIER_MODEL_ID}`)
  if (process.env.ANTHROPIC_API_KEY) return anthropic(CLASSIFIER_MODEL_ID)
  throw new Error('No LLM credentials for classifier')
}
```

- [ ] **Step 4: Run, expect 3 passed**

```bash
pnpm test tests/unit/classifier.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt/classify.ts src/lib/llm/model.ts tests/unit/classifier.test.ts
git commit -m "feat(prompt): intent classifier (haiku, p/g)"
```
