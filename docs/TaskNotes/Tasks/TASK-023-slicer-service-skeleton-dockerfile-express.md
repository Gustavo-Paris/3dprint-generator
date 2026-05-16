---
uid: task-023
status: done
priority: normal
scheduled: 2026-05-15
completed: 2026-05-15
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

# Slicer service skeleton (Dockerfile + Express)

**Files:** `slicer/Dockerfile`, `slicer/package.json`, `slicer/src/server.ts`, `slicer/README.md`

- [ ] **Step 1: `slicer/package.json`**

```json
{
  "name": "3dprint-slicer",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: `slicer/Dockerfile`**

```dockerfile
FROM ubuntu:24.04

# OrcaSlicer dependencies (Qt GUI + GL libs even in CLI mode)
RUN apt-get update && apt-get install -y \
    curl \
    libgtk-3-0 \
    libwebkit2gtk-4.1-0 \
    libgl1-mesa-glx \
    libegl1 \
    libosmesa6 \
    libgstreamer-plugins-base1.0-0 \
    libgstreamer1.0-0 \
    xvfb \
    libfuse2t64 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Download OrcaSlicer AppImage (v2.x)
WORKDIR /opt/orca
RUN curl -L -o orca.AppImage \
    https://github.com/SoftFever/OrcaSlicer/releases/download/v2.2.0/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.2.0.AppImage \
    && chmod +x orca.AppImage \
    && ./orca.AppImage --appimage-extract \
    && mv squashfs-root orca-extracted \
    && rm orca.AppImage

ENV ORCA_BIN=/opt/orca/orca-extracted/AppRun

WORKDIR /app
COPY package.json ./
RUN pnpm install
COPY src ./src
COPY profiles ./profiles

EXPOSE 8787
CMD ["pnpm", "start"]
```

NOTE: the exact AppImage URL above may need to be updated. Check https://github.com/SoftFever/OrcaSlicer/releases for the latest stable Ubuntu 24.04 build. If the URL above 404s during the docker build, replace `v2.2.0` with the latest matching tag, OR fall back to extracting whatever stable Linux AppImage is current.

- [ ] **Step 3: `slicer/src/server.ts` (skeleton — calls OrcaSlicer next task)**

```ts
import express from 'express'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const app = express()
app.use(express.json({ limit: '20mb' }))

const ORCA_BIN = process.env.ORCA_BIN ?? '/opt/orca/orca-extracted/AppRun'
const PROFILES_DIR = '/app/profiles'

app.get('/health', (_req, res) => {
  res.json({ ok: true, orca: ORCA_BIN })
})

app.post('/slice', async (req, res) => {
  const { stl_base64 } = req.body ?? {}
  if (typeof stl_base64 !== 'string' || stl_base64.length === 0) {
    return res.status(400).json({ error: 'stl_base64 (base64-encoded STL bytes) required' })
  }

  const work = mkdtempSync(join(tmpdir(), 'slice-'))
  try {
    const stlPath = join(work, 'in.stl')
    const outPath = join(work, 'out.3mf')
    writeFileSync(stlPath, Buffer.from(stl_base64, 'base64'))

    const result = spawnSync(ORCA_BIN, [
      '--slice', '0',
      '--load-settings', `${PROFILES_DIR}/machine_h2d_pla.json;${PROFILES_DIR}/process_h2d_pla_0.2mm.json`,
      '--load-filaments', `${PROFILES_DIR}/filament_generic_pla.json`,
      '--export-3mf', outPath,
      stlPath,
    ], { encoding: 'utf8' })

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'OrcaSlicer failed',
        stderr: result.stderr?.slice(0, 4000) ?? '',
        stdout: result.stdout?.slice(0, 4000) ?? '',
      })
    }

    const out = readFileSync(outPath)
    // Parse stats from OrcaSlicer stdout. The exact format varies — patterns to look for:
    //   "Print time:  XX min" or "estimated_printing_time_normal = X"
    //   "Filament used (g):  X" or "filament_weight = X"
    const stdout = result.stdout
    const timeMatch = stdout.match(/(?:print|estimated[_ ]printing)[\s_]*time[^:]*:?[\s_=]+([0-9.]+)/i)
    const weightMatch = stdout.match(/filament[\s_]*(?:used[\s_]*\(g\)|weight)[\s_]*:?[\s_=]+([0-9.]+)/i)

    res.json({
      bytes_base64: out.toString('base64'),
      meta: {
        print_time_min: timeMatch ? Number(timeMatch[1]) : null,
        filament_g: weightMatch ? Number(weightMatch[1]) : null,
        stdout_tail: stdout.slice(-1000),
      },
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  console.log(`Slicer service listening on :${port}`)
})
```

- [ ] **Step 4: `slicer/README.md`**

```markdown
# Slicer microservice

Headless OrcaSlicer CLI exposed as a tiny Express endpoint. Internal use only; runs on docker-compose alongside Postgres.

## Endpoints

- `GET /health` — liveness
- `POST /slice` — body: `{ "stl_base64": "<base64 STL bytes>" }` → `{ "bytes_base64": "<base64 3MF>", "meta": { print_time_min, filament_g } }`

## Profiles

`profiles/*.json` are OrcaSlicer-format machine/process/filament configs for Bambu Lab H2D + Generic PLA. Edit by exporting from OrcaSlicer's UI.

## Why local first

Phase 4 runs the slicer locally via docker-compose for fast iteration. Phase 5 deploys it to Railway.
```

- [ ] **Step 5: Commit (no build yet — that's Task 4)**

```bash
git add slicer/
git commit -m "feat(slicer): scaffold microservice skeleton with OrcaSlicer Dockerfile"
```
