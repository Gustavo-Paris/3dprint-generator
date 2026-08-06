---
uid: task-037
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-08-06
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

# Manual smoke (human only)

- [ ] **Step 1: Ensure env is set**

`.env.local` has `MESHY_API_KEY="msy_..."`. Restart `pnpm dev` if it was running before the key was added.

- [ ] **Step 2: Run the same suite of prompts, plus figurative ones**

Visit the test-login URL, create projects, send:

| Prompt | Expected strategy |
|---|---|
| `um cubo de 40mm` | parametric (jscad) |
| `um porta-chaves de 80x40x5mm` | parametric |
| `um capacete do homem de ferro tamanho real` | generative (meshy) |
| `uma miniatura de cachorro labrador` | generative |
| `uma luminária hexagonal com 5 furos circulares` | parametric |

For each:
- Check the strategy badge in chat
- Confirm viewer renders something recognizable
- For generative requests, expect ~30-90s wait with spinner
- After approving, click **Slice for printing** — slicer should accept the Meshy mesh (it's valid binary STL)

If generative quality is poor (Meshy preview is faster but lower-quality), revisit Task 2 step 4 and switch `mode: 'preview'` → `mode: 'refine'` (5x slower, much better).

- [ ] **Step 3: `tn done` the task and let the user report findings**
