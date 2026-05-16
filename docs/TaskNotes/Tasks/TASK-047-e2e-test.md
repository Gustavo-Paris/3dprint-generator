---
uid: task-047
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

# E2E test

**Files:** `tests/e2e/image-trophy-flow.spec.ts`

Mocks `/api/upload` to return a URL, then mocks `/api/generate` to return a generative response. Uploads a tiny PNG fixture, expects:
- Image thumbnail visible in chat history
- Strategy badge `meshy`
- Canvas renders

Commit: `test(e2e): image upload → trophy flow with mocked Meshy`.
