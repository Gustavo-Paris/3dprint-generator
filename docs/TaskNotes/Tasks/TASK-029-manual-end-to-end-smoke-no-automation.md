---
uid: task-029
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:4
- slicer
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Manual end-to-end smoke (no automation)

This task is **human only** — no subagent. Confirm the live system works.

- [ ] **Step 1: Bring everything up**

```bash
docker compose up -d
pnpm dev
```

- [ ] **Step 2: Sign in, generate, slice, download**

1. Visit `http://localhost:3000/api/auth/test-login?email=gustavo.b.paris@gmail.com`
2. Create a project ("smoke-slice")
3. Chat: `um suporte L de 40x40x40mm pra parafuso M4`
4. Wait for viewer to render
5. Click **Slice for printing** (top right of viewer)
6. After ~10–60s, stats panel appears (print time + filament)
7. Click **Download .3mf**
8. Open the file in Bambu Studio — it should load with the embedded G-code intact and printer set to H2D

If Bambu Studio refuses to open the file, surface the error and we adjust the OrcaSlicer profile / format.

- [ ] **Step 3: Mark done in tn**

```bash
tn done TASK-XXX  # whichever UID this task gets
```
