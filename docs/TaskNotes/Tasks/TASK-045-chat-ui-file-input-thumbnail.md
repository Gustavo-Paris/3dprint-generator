---
uid: task-045
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

# Chat UI — file input + thumbnail

**Files:** `src/components/Chat.tsx`

- Add a paperclip / image icon button next to the text input
- On click, opens file picker (accept="image/*")
- Selected file shows as a thumbnail above the input with an X to remove
- On submit: if image present, POST to `/api/upload` first, get URL, then POST to `/api/generate` with `imageUrl` included
- Disable send while uploading
- Assistant message in chat history shows the source image thumbnail when iteration has `imageBlobUrl`

Use react-hook-form is overkill; just `useState` for the file + URL state. The `initial` prop now includes optional `imageUrl` on user messages.

Commit: `feat(chat): image upload + thumbnail in chat history`.
