# Phase 4 — Local Slicer + 3MF Download

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After approving a generated model, user clicks "Slice for printing", receives a `.3mf` file with embedded G-code, slicing stats (print time, filament weight), and can send it to the Bambu H2D via Bambu Handy / LAN / SD.

**Architecture:** JSCAD worker → STL (browser) → `/api/slice` (Next.js) → slicer microservice (Docker, OrcaSlicer CLI, runs on docker-compose locally) → 3MF + stats → stored in Vercel Blob → signed URL back to client.

**Tech Stack:** OrcaSlicer 2.x CLI (Linux AppImage in Ubuntu 24.04 container), Express on Node 24, `@vercel/blob` client, Drizzle migration, react-query mutation for the slice button.

**Scope:**
- Local-only slicer (Railway deploy in Phase 5)
- Single-extruder PLA only (multi-extruder is Phase 2)
- Bundled OrcaSlicer profile for Bambu Lab H2D + Generic PLA
- 3MF output with G-code embedded (Bambu Handy / Cloud accepts this directly)

**Out of scope:**
- Slicer running on Railway / production (Phase 5)
- Profile customization UI (just one fixed profile)
- Layer-by-layer preview (just stats)
- Print job tracking / printer integration

**Out-of-band setup the human must do once:**
- Confirm Docker Desktop is running (already done in Phase 1)
- No Bambu account needed — slicer is fully local

---

## File Structure

```
3dprint-generator/
├── docker-compose.yml                       # MODIFY: add slicer service
├── slicer/                                  # NEW: standalone Docker service
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   └── server.ts                        # Express: POST /slice
│   ├── profiles/
│   │   ├── machine_h2d_pla.json             # OrcaSlicer machine profile
│   │   ├── process_h2d_pla_0.2mm.json       # OrcaSlicer process profile
│   │   └── filament_generic_pla.json        # OrcaSlicer filament profile
│   └── README.md
├── drizzle/<new migration>                  # Add: sliced_3mf_blob_url, sliced_meta cols
├── src/
│   ├── app/api/slice/route.ts               # NEW: proxy to slicer microservice
│   ├── components/
│   │   ├── SliceButton.tsx                  # NEW: "Slice for printing" + download UX
│   │   └── ProjectWorkspace.tsx             # MODIFY: mount SliceButton
│   ├── db/schema.ts                         # MODIFY: add sliced cols to iterations
│   └── lib/
│       ├── jscad/runner.ts                  # MODIFY: also produce STL bytes
│       ├── jscad/worker-entry.ts            # MODIFY: post STL in result
│       └── slicer/client.ts                 # NEW: thin fetch wrapper
└── tests/
    ├── unit/stl-export.test.ts              # NEW: STL bytes well-formed
    └── e2e/slice-flow.spec.ts               # NEW: happy path mock
```

---

## Task 1: Add STL export to JSCAD runner

**Files:** `src/lib/jscad/runner.ts`, `tests/unit/stl-export.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/stl-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runJscad } from '@/lib/jscad/runner'

describe('runJscad STL export', () => {
  it('produces binary STL bytes for a cuboid', async () => {
    const code = `const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] })\nmodule.exports = { main }`
    const r = await runJscad(code)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.stl).toBeInstanceOf(Uint8Array)
      // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes/triangle.
      // A cube triangulated has 12 triangles → 84 + 50*12 = 684 bytes.
      expect(r.stl.byteLength).toBe(684)
      // First 80 bytes are header text; 4 next are uint32 triangle count = 12
      const dv = new DataView(r.stl.buffer, r.stl.byteOffset, r.stl.byteLength)
      expect(dv.getUint32(80, true)).toBe(12)
    }
  })
})
```

- [ ] **Step 2: Run, expect failure** (TS error: `r.stl` doesn't exist)

```bash
pnpm test tests/unit/stl-export.test.ts
```

- [ ] **Step 3: Extend `JscadResult` and emit STL in `runner.ts`**

Modify `src/lib/jscad/runner.ts`. Replace the `JscadResult` type and the success branch:

```ts
export type JscadResult =
  | { ok: true; positions: Float32Array; triangleCount: number; stl: Uint8Array }
  | { ok: false; error: string }
```

Inside the `try` block right after `triangleCount` is computed, add the STL serialization before `return { ok: true, ... }`:

```ts
    const stl = serializeBinarySTL(positions)
    return {
      ok: true,
      positions: new Float32Array(positions),
      triangleCount: positions.length / 9,
      stl,
    }
```

And add this helper at the bottom of the same file:

```ts
function serializeBinarySTL(positions: number[]): Uint8Array {
  const triCount = positions.length / 9
  const buf = new ArrayBuffer(84 + 50 * triCount)
  const dv = new DataView(buf)
  // Bytes 0–79: header (zeroed) — leave as 0
  dv.setUint32(80, triCount, true)
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    const o = i * 9
    // Compute the face normal from the three vertices
    const ax = positions[o + 3] - positions[o]
    const ay = positions[o + 4] - positions[o + 1]
    const az = positions[o + 5] - positions[o + 2]
    const bx = positions[o + 6] - positions[o]
    const by = positions[o + 7] - positions[o + 1]
    const bz = positions[o + 8] - positions[o + 2]
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    dv.setFloat32(base, nx, true)
    dv.setFloat32(base + 4, ny, true)
    dv.setFloat32(base + 8, nz, true)
    for (let v = 0; v < 9; v++) {
      dv.setFloat32(base + 12 + v * 4, positions[o + v], true)
    }
    // attribute byte count = 0 (16-bit at offset base+48)
    dv.setUint16(base + 48, 0, true)
  }
  return new Uint8Array(buf)
}
```

Also: change the `positions: number[]` array used for triangulation to be retained instead of immediately turned into a Float32Array. The simplest approach — keep using `positions` as a `number[]` throughout the inner block, pass it to `serializeBinarySTL(positions)`, then wrap it in `Float32Array` for the return value.

- [ ] **Step 4: Run, expect 1 passed (+ all prior tests still pass)**

```bash
pnpm test tests/unit/stl-export.test.ts
pnpm test  # full suite
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jscad/runner.ts tests/unit/stl-export.test.ts
git commit -m "feat(jscad): export binary STL alongside mesh positions"
```

---

## Task 2: Schema migration for sliced output

**Files:** `src/db/schema.ts`, generated migration in `drizzle/`

- [ ] **Step 1: Extend the iterations table**

In `src/db/schema.ts`, add three nullable columns to the `iterations` table definition:

```ts
  // Existing iterations fields above ...
  slicedBlobUrl: text('sliced_blob_url'),
  slicedMeta: jsonb('sliced_meta'),          // { print_time_min: number, filament_g: number, layer_count: number }
  slicedAt: timestamp('sliced_at'),
```

Update the status enum to include `'sliced'`:

```ts
  status: text('status', { enum: ['generating', 'ready', 'failed', 'sliced'] }).notNull(),
```

- [ ] **Step 2: Generate + apply migration**

```bash
pnpm db:generate
pnpm db:migrate
docker exec 3dgen-postgres psql -U app -d app -c "\d iterations"
```

Expect to see `sliced_blob_url`, `sliced_meta`, `sliced_at` columns and the new enum value.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add sliced output columns to iterations"
```

---

## Task 3: Slicer service skeleton (Dockerfile + Express)

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

---

## Task 4: Bundle a minimal H2D PLA profile + verify build

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

---

## Task 5: Wire slicer into docker-compose

**Files:** `docker-compose.yml`

- [ ] **Step 1: Add slicer service**

Update `docker-compose.yml` (keep the existing postgres block):

```yaml
services:
  postgres:
    image: postgres:16
    container_name: 3dgen-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - 3dgen-pgdata:/var/lib/postgresql/data

  slicer:
    build: ./slicer
    container_name: 3dgen-slicer
    restart: unless-stopped
    environment:
      QT_QPA_PLATFORM: offscreen
      PORT: "8787"
    ports:
      - "8787:8787"

volumes:
  3dgen-pgdata:
```

- [ ] **Step 2: Bring it up**

```bash
docker compose up -d slicer
sleep 5
curl -s http://localhost:8787/health
```

Expect `{"ok":true,...}`. If it doesn't come up, `docker compose logs slicer` and debug.

- [ ] **Step 3: Smoke `/slice` with a tiny STL fixture**

```bash
# Generate a 10mm cube STL via a tiny node one-liner against the existing runner
pnpm exec tsx -e "
import { runJscad } from './src/lib/jscad/runner.ts'
const r = await runJscad(\`const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] }); module.exports = { main }\`)
if (r.ok) console.log(Buffer.from(r.stl).toString('base64'))
" > /tmp/cube.stl.b64

# Send to slicer
curl -s -X POST http://localhost:8787/slice \
  -H 'content-type: application/json' \
  -d "{\"stl_base64\":\"$(cat /tmp/cube.stl.b64 | tr -d '\n')\"}" \
  | head -c 500
```

Expect: JSON with `bytes_base64` (long string) + `meta`. If you see `error: OrcaSlicer failed`, inspect `stderr` in the response.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add slicer service to docker-compose"
```

---

## Task 6: Slicer client + `/api/slice` route

**Files:** `src/lib/slicer/client.ts`, `src/app/api/slice/route.ts`, `src/env.ts` (extend)

- [ ] **Step 1: Add `SLICER_URL` to env**

In `src/env.ts`, add `SLICER_URL: z.string().url().default('http://localhost:8787')` to the schema. Also append to `.env.example`:

```
SLICER_URL="http://localhost:8787"
```

- [ ] **Step 2: Slicer client**

`src/lib/slicer/client.ts`:

```ts
import { env } from '@/env'

export type SliceResult = {
  bytes: Uint8Array
  meta: {
    print_time_min: number | null
    filament_g: number | null
  }
}

export async function sliceStl(stl: Uint8Array): Promise<SliceResult> {
  const stl_base64 = Buffer.from(stl).toString('base64')
  const res = await fetch(`${env.SLICER_URL}/slice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stl_base64 }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`Slicer ${res.status}: ${errorBody.slice(0, 1000)}`)
  }

  const json = (await res.json()) as { bytes_base64: string; meta: SliceResult['meta'] }
  return { bytes: Buffer.from(json.bytes_base64, 'base64'), meta: json.meta }
}
```

- [ ] **Step 3: `/api/slice` route**

`src/app/api/slice/route.ts`:

```ts
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { sliceStl } from '@/lib/slicer/client'
import { put } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 180

const Body = z.object({
  iterationId: z.string().uuid(),
  stlBase64: z.string().min(1),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })
  const { iterationId, stlBase64 } = parsed.data

  // Verify the iteration belongs to a project the user owns.
  const [row] = await db
    .select({ iteration: iterations, project: projects })
    .from(iterations)
    .innerJoin(projects, eq(iterations.projectId, projects.id))
    .where(and(eq(iterations.id, iterationId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!row) return new Response('Not found', { status: 404 })

  let result
  try {
    result = await sliceStl(Buffer.from(stlBase64, 'base64'))
  } catch (e) {
    return new Response(`Slicer error: ${(e as Error).message}`, { status: 502 })
  }

  // Upload 3MF to Blob. Skip if BLOB_READ_WRITE_TOKEN is missing in dev — fall back
  // to returning the base64 inline (the client knows how to download both).
  const filename = `${session.user.id}/${row.project.id}/${iterationId}.3mf`
  let slicedUrl: string | null = null
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(filename, result.bytes, { access: 'public', addRandomSuffix: false })
    slicedUrl = blob.url
  }

  await db
    .update(iterations)
    .set({
      slicedBlobUrl: slicedUrl,
      slicedMeta: result.meta,
      slicedAt: new Date(),
      status: 'sliced',
    })
    .where(eq(iterations.id, iterationId))

  return Response.json({
    url: slicedUrl,
    inline_base64: slicedUrl ? null : Buffer.from(result.bytes).toString('base64'),
    meta: result.meta,
  })
}
```

- [ ] **Step 4: tsc clean**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/lib/slicer/ src/app/api/slice/ .env.example
git commit -m "feat(api): /api/slice proxies STL → slicer → 3MF, persists meta"
```

---

## Task 7: "Slice for printing" UI button + download

**Files:** `src/components/SliceButton.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Build the button**

`src/components/SliceButton.tsx`:

```tsx
'use client'
import { useState } from 'react'

type SliceMeta = { print_time_min: number | null; filament_g: number | null }
type SliceResponse = { url: string | null; inline_base64: string | null; meta: SliceMeta }

export default function SliceButton({
  iterationId,
  stl,
}: {
  iterationId: string | null
  stl: Uint8Array | null
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SliceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (!iterationId || !stl) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const stlBase64 = btoa(String.fromCharCode(...stl))
      const res = await fetch('/api/slice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ iterationId, stlBase64 }),
      })
      if (!res.ok) throw new Error(await res.text())
      setResult((await res.json()) as SliceResponse)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function download() {
    if (!result) return
    const blob =
      result.url
        ? null
        : new Blob([Uint8Array.from(atob(result.inline_base64!), (c) => c.charCodeAt(0))], {
            type: 'model/3mf',
          })
    const href = result.url ?? URL.createObjectURL(blob!)
    const a = document.createElement('a')
    a.href = href
    a.download = `${iterationId}.3mf`
    a.click()
    if (!result.url) setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  if (!iterationId || !stl) return null

  return (
    <div className="absolute top-4 right-4 flex flex-col items-end gap-2 z-10">
      <button
        onClick={onClick}
        disabled={busy}
        className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50 shadow"
      >
        {busy ? 'Slicing…' : 'Slice for printing'}
      </button>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded px-3 py-2 text-xs max-w-xs">
          {error}
        </div>
      )}
      {result && (
        <div className="bg-white border rounded p-3 text-xs shadow space-y-2">
          <div>
            <span className="text-gray-500">Print time: </span>
            <strong>{result.meta.print_time_min ? `${result.meta.print_time_min.toFixed(0)} min` : '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">Filament: </span>
            <strong>{result.meta.filament_g ? `${result.meta.filament_g.toFixed(1)} g` : '—'}</strong>
          </div>
          <button onClick={download} className="w-full bg-emerald-600 text-white rounded px-3 py-2">
            Download .3mf
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount in `ProjectWorkspace.tsx`**

Track the STL + iterationId in workspace state alongside `code`. Modify `src/components/ProjectWorkspace.tsx`:

Add to the imports:
```tsx
import SliceButton from './SliceButton'
```

Change the `runInWorker` effect to also capture the STL:
```tsx
const [stl, setStl] = useState<Uint8Array | null>(null)
const [iterationId, setIterationId] = useState<string | null>(
  initialHistory.findLast((it) => it.status === 'ready' || it.status === 'sliced')?.id ?? null,
)
```

In the `runInWorker(code).then(...)`:
```tsx
if (r.ok) {
  setPositions(r.positions)
  setStl(r.stl)
} else {
  setPositions(null)
  setStl(null)
  setError(r.error)
}
```

In the `onIterationReady` callback of `<Chat>`, also set `iterationId`:
```tsx
onIterationReady={(id, c) => {
  setIterationId(id)
  setCode(c)
}}
```

In the viewer `<section>`, add the button alongside the canvas:
```tsx
<section className="relative bg-gray-50" data-testid="viewer-slot">
  <MeshViewer positions={positions} />
  <SliceButton iterationId={iterationId} stl={stl} />
  {error && (
    <div className="absolute bottom-4 left-4 right-4 bg-red-50 ...">
      ...
    </div>
  )}
</section>
```

- [ ] **Step 3: tsc clean**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/SliceButton.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(slice): button + download + stats panel"
```

---

## Task 8: E2E happy path

**Files:** `tests/e2e/slice-flow.spec.ts`

- [ ] **Step 1: Mocked slice E2E test**

`tests/e2e/slice-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signInE2E } from './session-helper'

const FIXTURE_CODE = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })
module.exports = { main }`

test('user generates a cube, slices it, downloads 3MF', async ({ page }) => {
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'x-iteration-id': '00000000-0000-0000-0000-000000000099',
        'content-type': 'text/plain',
      },
      body: FIXTURE_CODE,
    })
  })

  // Mock /api/slice — we don't want to invoke the real slicer in CI
  await page.route('**/api/slice', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: null,
        inline_base64: Buffer.from('PKfake-3mf-bytes').toString('base64'),
        meta: { print_time_min: 42, filament_g: 7.3 },
      }),
    })
  })

  await signInE2E(page, process.env.E2E_TEST_EMAIL || 'gustavo.b.paris@gmail.com')
  await page.fill('input[name="title"]', 'Slice E2E')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/projects\//)

  await page.fill('[data-testid="chat-input"]', 'a cube')
  await page.locator('[data-testid="chat-input"]').press('Enter')
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 })

  // Slice
  await page.click('button:has-text("Slice for printing")')
  await expect(page.locator('text=42 min')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('text=7.3 g')).toBeVisible()
  // The download button is now present
  await expect(page.locator('button:has-text("Download .3mf")')).toBeVisible()
})
```

- [ ] **Step 2: Run**

```bash
E2E_ALLOW_TEST_LOGIN=1 pnpm test:e2e tests/e2e/slice-flow.spec.ts
```

Expect: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/slice-flow.spec.ts
git commit -m "test(e2e): slice flow happy path with mocked slicer"
```

---

## Task 9: Manual end-to-end smoke (no automation)

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

---

## Phase 4 — Done criteria

- [ ] STL export from JSCAD runner is tested and produces well-formed binary STL.
- [ ] Slicer service builds with `docker compose build slicer` and `/health` returns 200.
- [ ] `POST /api/slice` returns a 3MF when given an STL of a known-good model.
- [ ] Slice button renders, calls the API, shows stats, and downloads a 3MF.
- [ ] Iterations rows for sliced models have `status='sliced'`, `sliced_blob_url` populated (or null with inline fallback), and `sliced_meta` populated.
- [ ] Bambu Studio successfully opens the downloaded 3MF.

## What's next (out of scope here)

- **Phase 4.5 / 5:** Deploy slicer to Railway. Replace `SLICER_URL=http://localhost:8787` with the Railway URL. Add HMAC signing on requests.
- **Phase 2:** Multi-extruder support — 3MF carries multi-body geometry; this phase only generates single-body 3MF.
- **Phase 5:** Iteration history UI, version rollback, viewer polish (chat text contrast bug noted in Phase 1 smoke), sandbox hardening.

## Tracking

Tasks created by `/tn-from-plan` on 2026-05-15 23:26:14:
- TASK-021: Add STL export to JSCAD runner
- TASK-022: Schema migration for sliced output
- TASK-023: Slicer service skeleton (Dockerfile + Express)
- TASK-024: Bundle a minimal H2D PLA profile + verify build
- TASK-025: Wire slicer into docker-compose
- TASK-026: Slicer client + `/api/slice` route
- TASK-027: "Slice for printing" UI button + download
- TASK-028: E2E happy path
- TASK-029: Manual end-to-end smoke (no automation)
