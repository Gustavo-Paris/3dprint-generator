---
uid: task-046
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

# ProjectWorkspace — render image in history

**Files:** `src/components/ProjectWorkspace.tsx`

Initial history hydration: for each iteration with `imageBlobUrl`, render the user message as `<img src={imageBlobUrl} className="max-w-[200px] rounded">` + the text.

The viewer + SliceButton logic stays the same — they only care about positions + STL.

Commit: `feat(workspace): show source image in chat history`.
