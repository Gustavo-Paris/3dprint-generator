---
uid: task-041
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-05-16
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

# Base-keyword detector

**Files:** `src/lib/prompt/base-detect.ts`, `tests/unit/base-detect.test.ts`

```ts
// base-detect.ts
const KEYWORDS = [
  // pt
  'troféu', 'trofeu', 'prêmio', 'premio', 'pedestal', 'base', 'suporte', 'pódio', 'podio',
  // en
  'trophy', 'prize', 'pedestal', 'stand', 'plinth', 'mount', 'award',
]

const NEGATIVE = [
  'sem base', 'no base', 'apenas a logo', 'just the logo', 'só a logo', 'so a logo',
]

export function detectBaseMode(text: string): 'mesh_only' | 'with_base' {
  const lower = text.toLowerCase()
  if (NEGATIVE.some((n) => lower.includes(n))) return 'mesh_only'
  if (KEYWORDS.some((k) => lower.includes(k))) return 'with_base'
  return 'mesh_only' // default: don't surprise the user with a base they didn't ask for
}
```

Tests:
- `'troféu da logo da empresa'` → `with_base`
- `'logo extrudada'` → `mesh_only`
- `'troféu sem base'` → `mesh_only`
- `'prize stand'` → `with_base`
- `'random text'` → `mesh_only`

Commit: `feat(prompt): detect trophy-base keywords in user text`.
