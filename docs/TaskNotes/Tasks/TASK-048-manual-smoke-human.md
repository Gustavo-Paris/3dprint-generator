---
uid: task-048
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-08-06
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

# Manual smoke (human)

1. Bring all infra up (`docker compose up -d`, `pnpm dev`)
2. Login, create project "Trofeu logo"
3. Click attach → upload your company logo (PNG)
4. Type "troféu da nossa logo" → send
5. Wait ~5-7min (image-to-3D 2-stage + composition)
6. Viewer renders: logo extruded on top of cylindrical base
7. Slice for printing → 3MF
8. Open in Bambu Studio — should import cleanly (no manifold errors thanks to refine + clean parametric base)

If manifold errors persist, surface stderr — the issue is likely the seam between top and base where they overlap (0.5mm overlap may not be enough; bump to 1-2mm).
