---
uid: task-024
status: done
priority: normal
scheduled: 2026-05-15
completed: 2026-05-16
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

# Bundle a minimal H2D PLA profile + verify build

**Files:** `slicer/profiles/*.json`

The Bambu H2D profile in OrcaSlicer is shipped as preset JSON files. We bundle a minimal working trio. **You must run OrcaSlicer once on the host machine (any OS) to export these — or hand-write minimal JSONs that OrcaSlicer accepts.**

- [ ] **Step 1: Export profiles**

Easiest path: install OrcaSlicer on macOS host, pick the Bambu Lab H2D printer in the wizard, accept defaults for "0.2mm standard quality" + "Generic PLA". Then in OrcaSlicer: *File → Export → Export config bundle…* This dumps three JSONs. Save them as:

- `slicer/profiles/machine_h2d_pla.json` — printer settings
- `slicer/profiles/process_h2d_pla_0.2mm.json` — quality preset
- `slicer/profiles/filament_generic_pla.json` — filament settings

Alternative if export feels too heavy: copy them from OrcaSlicer's resource dir:
- macOS: `~/Library/Application Support/OrcaSlicer/system/BBL/`
- Files to copy: `machine/Bambu Lab H2D 0.4 nozzle.json`, `process/0.20mm Standard @BBL X1.json` (closest available), `filament/Bambu PLA Basic @BBL X1.json`. Rename per the convention above.

You may need to edit the JSONs to set `"inherits"` to `null` (or remove the field) so OrcaSlicer doesn't try to resolve a parent preset that doesn't exist in the bundled tree.

- [ ] **Step 2: Build the slicer image**

```bash
docker compose build slicer  # (slicer service added in Task 5; you can pre-build with `docker build -t 3dgen-slicer slicer/`)
```

If the AppImage URL 404s, look up the latest tag at https://github.com/SoftFever/OrcaSlicer/releases/latest and update the Dockerfile.

- [ ] **Step 3: Spot-check the binary inside the container**

```bash
docker run --rm 3dgen-slicer /opt/orca/orca-extracted/AppRun --help 2>&1 | head -30
```

Expect: OrcaSlicer CLI help text. If you see a Qt platform plugin error, you'll need to add `-e QT_QPA_PLATFORM=offscreen` to the docker run.

- [ ] **Step 4: Commit**

```bash
git add slicer/profiles/
git commit -m "feat(slicer): bundle H2D + generic PLA profile for OrcaSlicer"
```

If you cannot get profiles working in this task, mark it **BLOCKED** and surface the OrcaSlicer error message. Do not fabricate profile JSONs.
