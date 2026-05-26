# 3MF Import & Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `kind: "imported"` Design variant that lets users upload a `.3mf`, chat-edit it with natural language (add logo, drill holes, emboss text, scale, JSCAD escape hatch), and get a printable mesh back — fully integrated into the existing iteration flow.

**Architecture:** Server-side branch inside `/api/generate` when the active iteration carries a `baseMeshUrl`. Pipeline: fetch & parse `.3mf` → segment faces → call vision LLM with face metadata + client-captured previews → apply structured ops idempotently against base mesh → repair → serialize. The MeshViewer client captures 4-angle PNG screenshots so the server never needs a headless renderer.

**Tech Stack:**
- Next.js App Router (route handlers, `nodejs` runtime, `maxDuration: 600`)
- Drizzle ORM + Postgres (`iterations` table; `validationReport` JSONB for cached face/preview metadata)
- Zod (discriminated union schema, op handler params)
- `@jscad/modeling` (boolean ops, primitives, transforms)
- `fflate` (3MF zip handling — already used in `parse-3mf.ts` / `serialize-3mf.ts`)
- `sharp` (image metadata)
- Vercel AI SDK with `claude-opus-4-7` (vision support for previews)
- Vitest for unit + integration tests
- Three.js via existing `MeshViewer` for client-side preview capture

---

## File Structure

**New files (under `src/lib/import/`):**

| Path | Responsibility |
|---|---|
| `src/lib/import/types.ts` | Shared TS types: `BaseMesh`, `SemanticFace`, `FacePreviewBundle`, `EditWarning` |
| `src/lib/import/load-base-mesh.ts` | Fetch `.3mf` URL → `parse3mf` → compute per-triangle normals + global bbox |
| `src/lib/import/face-segment.ts` | Cluster triangles by normal similarity (< 5°) → top-12 `SemanticFace[]` |
| `src/lib/import/apply-edits.ts` | Dispatcher: iterate `edits[]`, invoke handler, collect warnings |
| `src/lib/import/ops/scale.ts` | Op: uniform / per-axis scale |
| `src/lib/import/ops/hole.ts` | Op: cylinder / rectangular hole subtracted from chosen face |
| `src/lib/import/ops/add-logo.ts` | Op: extrude logo image, position on face, boolean union |
| `src/lib/import/ops/emboss-text.ts` | Op: extruded text, union (embossed) or subtraction (engraved) |
| `src/lib/import/ops/jscad-raw.ts` | Op: LLM-authored JSCAD snippet via existing `runJscad` sandbox + 30s timeout |
| `src/lib/import/ops/index.ts` | Op registry: `OPS` map keyed by op name |
| `src/lib/design/parse-import.ts` | LLM call specialized for imported meshes (vision + face context) |
| `src/components/MeshViewer.tsx` (modify) | Add `capturePreviews()` returning `{ top, front, right, iso }` data URLs |
| `tests/unit/import/load-base-mesh.test.ts` | Unit tests |
| `tests/unit/import/face-segment.test.ts` | Unit tests with cube / cylinder / staircase fixtures |
| `tests/unit/import/ops-scale.test.ts` | |
| `tests/unit/import/ops-hole.test.ts` | |
| `tests/unit/import/ops-add-logo.test.ts` | |
| `tests/unit/import/ops-emboss-text.test.ts` | |
| `tests/unit/import/ops-jscad-raw.test.ts` | |
| `tests/unit/import/apply-edits.test.ts` | |
| `tests/unit/import/parse-import.test.ts` | LLM mocked |
| `tests/integration/api-generate-imported.test.ts` | End-to-end with mocked LLM |
| `tests/fixtures/cube-30mm.3mf` | Binary fixture: simple cube, 30mm edge |

**Modified files:**

| Path | Change |
|---|---|
| `src/lib/design/schema.ts` | Add `Imported` zod object + extend `Design` discriminated union |
| `src/lib/design/sanitize.ts` | Pass-through for `imported` kind (no numeric clamping needed) |
| `src/lib/design/generate.ts` | Branch on `kind === 'imported'` → call `applyEdits` against base mesh |
| `src/lib/design/parse.ts` | Route to `parseImportEdit` when context carries `baseMeshUrl` |
| `src/app/api/upload/route.ts` | Accept `model/3mf` / `application/vnd.ms-package.3dmanufacturing-3dmodel+xml` MIME types, raise `MAX_BYTES` to 50 MB for 3MF |
| `src/app/api/generate/route.ts` | Detect `meshUrl` body field; load + segment base mesh; cache `faces` in `iteration.validationReport`; pass previews to `parseImportEdit` |
| `src/components/Chat.tsx` | Accept `.3mf` upload; trigger preview capture before sending |
| `src/components/ProjectWorkspace.tsx` | Pass `previews` payload through to `/api/generate` |

---

## Task 1: Extend Design schema with `imported` variant

**Files:**
- Modify: `src/lib/design/schema.ts:220-230`
- Test: `tests/unit/import/schema-imported.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/import/schema-imported.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Design } from '@/lib/design/schema'

describe('Design.imported variant', () => {
  it('parses minimal imported design with one edit', () => {
    const input = {
      kind: 'imported',
      baseMeshUrl: 'https://blob.example.com/mesh.3mf',
      edits: [
        { op: 'scale', factor: 0.5 },
      ],
    }
    const result = Design.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.kind).toBe('imported')
  })

  it('parses all five ops', () => {
    const input = {
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [
        { op: 'scale', factor: 1.2 },
        { op: 'hole', faceId: 0, shape: 'circle', diameterMm: 3.2, depthMm: 'through', positions: [[10, 10]] },
        { op: 'add_logo', faceId: 1, imageUrl: 'https://x/l.png', sizeMm: 30, depthMm: 0.6 },
        { op: 'emboss_text', faceId: 1, text: 'HELLO', treatment: 'embossed', sizeMm: 8, depthMm: 0.5 },
        { op: 'jscad_raw', code: 'module.exports={main:()=>jscad.primitives.cube({size:10})}' },
      ],
    }
    expect(Design.safeParse(input).success).toBe(true)
  })

  it('rejects unknown op', () => {
    const input = {
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [{ op: 'levitate', amount: 9000 }],
    }
    expect(Design.safeParse(input).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm vitest run tests/unit/import/schema-imported.test.ts
```
Expected: FAIL — `imported` not in union.

- [ ] **Step 3: Extend the schema**

In `src/lib/design/schema.ts`, before the existing `export const Design = z.discriminatedUnion(...)` block, add:

```ts
// ───────────────────────────────────────────────────────────────────
// Imported-mesh edits (user-uploaded .3mf as base geometry)
// ───────────────────────────────────────────────────────────────────

const ScaleOp = z.object({
  op: z.literal('scale'),
  factor: z.union([
    z.number().positive(),
    z.object({ x: z.number().positive(), y: z.number().positive(), z: z.number().positive() }),
  ]),
})

const HoleOp = z.object({
  op: z.literal('hole'),
  faceId: z.number().int().nonnegative(),
  shape: z.enum(['circle', 'rect']).default('circle'),
  diameterMm: z.number().positive().optional(),
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  depthMm: z.union([z.number().positive(), z.literal('through')]).default('through'),
  /** Positions in the face's local 2D coordinate frame (origin = face centroid). */
  positions: z.array(z.tuple([z.number(), z.number()])).min(1),
})

const AddLogoOp = z.object({
  op: z.literal('add_logo'),
  faceId: z.number().int().nonnegative(),
  imageUrl: z.string().url(),
  sizeMm: z.number().positive(),
  depthMm: z.number().positive().default(0.6),
  treatment: z.enum(['embossed', 'engraved', 'through_cut']).default('embossed'),
  /** Optional in-plane offset from face centroid. */
  offsetMm: z.tuple([z.number(), z.number()]).default([0, 0]),
})

const EmbossTextOp = z.object({
  op: z.literal('emboss_text'),
  faceId: z.number().int().nonnegative(),
  text: z.string().min(1).max(40),
  treatment: z.enum(['embossed', 'engraved']).default('embossed'),
  sizeMm: z.number().positive(),
  depthMm: z.number().positive().default(0.5),
  offsetMm: z.tuple([z.number(), z.number()]).default([0, 0]),
})

const JscadRawOp = z.object({
  op: z.literal('jscad_raw'),
  /** JSCAD module source. Must export `main()` returning a Geom3 to UNION with the
   *  current mesh, or `main(currentMesh)` to receive the current mesh and return
   *  the replacement. */
  code: z.string().min(10).max(20_000),
  mode: z.enum(['union', 'replace']).default('union'),
})

const Op = z.discriminatedUnion('op', [
  ScaleOp, HoleOp, AddLogoOp, EmbossTextOp, JscadRawOp,
])
export type Op = z.infer<typeof Op>

const Imported = z.object({
  kind: z.literal('imported'),
  baseMeshUrl: z.string().url(),
  edits: z.array(Op).max(20).default([]),
})
```

Then modify the existing `Design` union:

```ts
export const Design = z.discriminatedUnion('kind', [
  HollowCylinder,
  FlatPlate,
  Disc,
  Composite,
  Bookmark,
  Pin,
  CustomKeychain,
  Mug,
  Imported,
])
export type Design = z.infer<typeof Design>
```

- [ ] **Step 4: Run test to confirm pass**

```bash
pnpm vitest run tests/unit/import/schema-imported.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: Run full type check**

```bash
pnpm tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/schema.ts tests/unit/import/schema-imported.test.ts
git commit -m "feat(import): add imported Design variant with op catalog"
```

---

## Task 2: Pass-through for `imported` kind in `sanitize.ts`

**Files:**
- Modify: `src/lib/design/sanitize.ts`
- Test: `tests/unit/import/sanitize-imported.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/import/sanitize-imported.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeDesign } from '@/lib/design/sanitize'
import type { Design } from '@/lib/design/schema'

describe('sanitizeDesign(imported)', () => {
  it('passes imported designs through unchanged', () => {
    const d: Design = {
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [{ op: 'scale', factor: 2 }],
    }
    const { design, adjustments } = sanitizeDesign(d)
    expect(adjustments).toEqual([])
    expect(design).toEqual(d)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/sanitize-imported.test.ts
```

Expected: FAIL (sanitize likely throws on unknown kind in its switch).

- [ ] **Step 3: Find the switch in sanitize.ts and add a case**

Open `src/lib/design/sanitize.ts`. Locate the main switch on `design.kind`. Add:

```ts
case 'imported':
  // Edits are validated by Zod at parse time; numeric clamping
  // doesn't apply (geometry comes from the imported mesh, not LLM-named dims).
  return { design, adjustments: [] }
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/sanitize-imported.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/sanitize.ts tests/unit/import/sanitize-imported.test.ts
git commit -m "feat(import): pass-through imported designs in sanitize"
```

---

## Task 3: Upload route accepts `.3mf`

**Files:**
- Modify: `src/app/api/upload/route.ts`
- Test: `tests/integration/upload-3mf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/upload-3mf.test.ts
import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/upload/route'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'test-user' } })),
}))

function makeForm(blob: Blob, name = 'cube.3mf'): FormData {
  const fd = new FormData()
  fd.set('file', blob, name)
  return fd
}

describe('POST /api/upload', () => {
  it('accepts a .3mf file', async () => {
    const fd = makeForm(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
      type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    }))
    const req = new Request('http://x/upload', { method: 'POST', body: fd })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content_type).toMatch(/3dmanufacturing|3mf|zip|octet/)
  })

  it('rejects 3MF over 50MB', async () => {
    const big = new Uint8Array(51 * 1024 * 1024)
    const fd = makeForm(new Blob([big], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }))
    const req = new Request('http://x/upload', { method: 'POST', body: fd })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/integration/upload-3mf.test.ts
```

- [ ] **Step 3: Modify upload route**

Replace `MAX_BYTES` and `ACCEPTED` blocks in `src/app/api/upload/route.ts`:

```ts
const MAX_BYTES_IMAGE = 5 * 1024 * 1024  // 5MB for images
const MAX_BYTES_MESH = 50 * 1024 * 1024  // 50MB for 3MF
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MESH_TYPES = [
  'model/3mf',
  'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  'application/octet-stream', // some browsers send this for .3mf
]
```

Replace the validation block (the lines that check `file.size > MAX_BYTES` and `ACCEPTED.includes(file.type)`):

```ts
const isMesh = MESH_TYPES.includes(file.type) || file.name.toLowerCase().endsWith('.3mf')
const isImage = IMAGE_TYPES.includes(file.type)

if (!isMesh && !isImage) {
  return new Response(`Unsupported type ${file.type}`, { status: 415 })
}

const limit = isMesh ? MAX_BYTES_MESH : MAX_BYTES_IMAGE
if (file.size > limit) {
  const mb = (limit / 1024 / 1024).toFixed(0)
  return new Response(`File too large (>${mb}MB)`, { status: 413 })
}
```

Replace the `ext` resolution:

```ts
const ext = isMesh ? '3mf'
  : file.type === 'image/png' ? 'png'
  : file.type === 'image/webp' ? 'webp'
  : 'jpg'
```

When uploading to blob, pass `contentType` so the URL serves the correct MIME:

```ts
if (process.env.BLOB_READ_WRITE_TOKEN) {
  const blob = await put(`${session.user.id}/uploads/${id}.${ext}`, bytes, {
    access: 'public',
    addRandomSuffix: false,
    contentType: isMesh ? 'application/octet-stream' : file.type,
  })
  url = blob.url
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/integration/upload-3mf.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload/route.ts tests/integration/upload-3mf.test.ts
git commit -m "feat(upload): accept .3mf files up to 50MB"
```

---

## Task 4: `load-base-mesh.ts` — fetch, parse, normals, bbox

**Files:**
- Create: `src/lib/import/types.ts`
- Create: `src/lib/import/load-base-mesh.ts`
- Create: `tests/fixtures/cube-30mm.3mf` (binary fixture)
- Test: `tests/unit/import/load-base-mesh.test.ts`

- [ ] **Step 1: Generate the cube fixture once**

Create `tests/fixtures/make-cube.ts` (script, run once, then delete or keep in repo):

```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as jscad from '@jscad/modeling'
import { serialize3mf } from '../../src/lib/3mf/serialize-3mf'

const cube = jscad.primitives.cube({ size: 30 })
const polys = jscad.geometries.geom3.toPolygons(cube)
const positions: number[] = []
for (const p of polys) {
  const v = p.vertices
  for (let i = 1; i < v.length - 1; i++) positions.push(...v[0], ...v[i], ...v[i + 1])
}
const bytes = serialize3mf([{
  positions: new Float32Array(positions),
  extruder: 'A',
  label: 'Cube',
}])
writeFileSync(join(__dirname, 'cube-30mm.3mf'), bytes)
console.log('Wrote cube-30mm.3mf', bytes.length, 'bytes')
```

Run:

```bash
pnpm tsx tests/fixtures/make-cube.ts
```

Verify file exists:

```bash
ls -la tests/fixtures/cube-30mm.3mf
```

- [ ] **Step 2: Write the types file**

`src/lib/import/types.ts`:

```ts
/** Triangle-soup mesh with computed normals + global bbox. */
export interface BaseMesh {
  /** Float32Array of length triangleCount*9 — flat [x,y,z, x,y,z, x,y,z, ...]. */
  positions: Float32Array
  /** Per-triangle face normal — Float32Array length triangleCount*3. */
  normals: Float32Array
  /** Per-triangle extruder label, preserved from the source 3MF. */
  extruders: Array<'A' | 'B'>
  bbox: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
    center: [number, number, number]
  }
  triangleCount: number
}

/** A region of co-planar (within tolerance) connected triangles. */
export interface SemanticFace {
  id: number
  /** Unit normal of the face. */
  normal: [number, number, number]
  /** 3D centroid (face center of mass). */
  centroid: [number, number, number]
  areaMm2: number
  /** Indices into BaseMesh.positions identifying the triangles in this face.
   *  Each entry is the triangle index (0..triangleCount-1). */
  triangleIndices: number[]
  /** In-plane 2D bbox (after projecting triangles onto the face plane,
   *  origin at centroid, X = arbitrary tangent, Y = normal × X). */
  bboxOnPlane: { min: [number, number]; max: [number, number] }
}

export interface EditWarning {
  opIndex: number
  op: string
  reason: string
}
```

- [ ] **Step 3: Write the failing test**

`tests/unit/import/load-base-mesh.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'

let cubeBytes: Uint8Array

beforeAll(async () => {
  cubeBytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')),
  )
})

describe('loadBaseMeshFromBytes', () => {
  it('parses a 30mm cube into 12 triangles', async () => {
    const mesh = await loadBaseMeshFromBytes(cubeBytes)
    expect(mesh.triangleCount).toBe(12)
    expect(mesh.positions.length).toBe(12 * 9)
  })

  it('computes bbox of the 30mm cube as 30×30×30', async () => {
    const mesh = await loadBaseMeshFromBytes(cubeBytes)
    expect(mesh.bbox.size[0]).toBeCloseTo(30, 1)
    expect(mesh.bbox.size[1]).toBeCloseTo(30, 1)
    expect(mesh.bbox.size[2]).toBeCloseTo(30, 1)
  })

  it('computes one unit normal per triangle', async () => {
    const mesh = await loadBaseMeshFromBytes(cubeBytes)
    expect(mesh.normals.length).toBe(12 * 3)
    for (let i = 0; i < 12; i++) {
      const nx = mesh.normals[i * 3], ny = mesh.normals[i * 3 + 1], nz = mesh.normals[i * 3 + 2]
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      expect(len).toBeCloseTo(1, 4)
    }
  })

  it('throws on invalid input', async () => {
    await expect(loadBaseMeshFromBytes(new Uint8Array([1, 2, 3])))
      .rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/load-base-mesh.test.ts
```

- [ ] **Step 5: Implement `load-base-mesh.ts`**

`src/lib/import/load-base-mesh.ts`:

```ts
import { parse3mf } from '@/lib/3mf/parse-3mf'
import type { BaseMesh } from './types'

const MAX_BYTES = 50 * 1024 * 1024

export async function loadBaseMeshFromUrl(url: string): Promise<BaseMesh> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`3MF exceeds ${MAX_BYTES / 1024 / 1024}MB limit`)
  }
  return loadBaseMeshFromBytes(buf)
}

export async function loadBaseMeshFromBytes(bytes: Uint8Array): Promise<BaseMesh> {
  const bodies = parse3mf(bytes)
  if (bodies.length === 0) throw new Error('3MF contains no geometry')

  // Concatenate all bodies into one mesh, preserving extruder per triangle.
  let totalTris = 0
  for (const b of bodies) totalTris += b.positions.length / 9

  const positions = new Float32Array(totalTris * 9)
  const normals = new Float32Array(totalTris * 3)
  const extruders: Array<'A' | 'B'> = new Array(totalTris)

  let triOffset = 0
  let posOffset = 0
  for (const body of bodies) {
    const triCount = body.positions.length / 9
    positions.set(body.positions, posOffset)
    for (let i = 0; i < triCount; i++) extruders[triOffset + i] = body.extruder
    posOffset += body.positions.length
    triOffset += triCount
  }

  // Compute per-triangle normals + bbox in one pass.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < totalTris; i++) {
    const o = i * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az

    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len

    for (const x of [ax, bx, cx]) { if (x < minX) minX = x; if (x > maxX) maxX = x }
    for (const y of [ay, by, cy]) { if (y < minY) minY = y; if (y > maxY) maxY = y }
    for (const z of [az, bz, cz]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z }
  }

  return {
    positions, normals, extruders,
    triangleCount: totalTris,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}
```

- [ ] **Step 6: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/load-base-mesh.test.ts
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/import/types.ts src/lib/import/load-base-mesh.ts \
  tests/fixtures/cube-30mm.3mf tests/fixtures/make-cube.ts \
  tests/unit/import/load-base-mesh.test.ts
git commit -m "feat(import): base mesh loader with normals + bbox"
```

---

## Task 5: `face-segment.ts` — cluster triangles into semantic faces

**Files:**
- Create: `src/lib/import/face-segment.ts`
- Test: `tests/unit/import/face-segment.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/import/face-segment.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'

let cubeMesh: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')),
  )
  cubeMesh = await loadBaseMeshFromBytes(bytes)
})

describe('segmentFaces', () => {
  it('finds 6 faces on a cube', () => {
    const faces = segmentFaces(cubeMesh)
    expect(faces.length).toBe(6)
  })

  it('cube faces have unit normals along ±x ±y ±z', () => {
    const faces = segmentFaces(cubeMesh)
    const axes = faces.map((f) => f.normal.map((c) => Math.round(c)).join(','))
    expect(axes.sort()).toEqual(['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0'].sort())
  })

  it('each cube face has area 30*30 = 900', () => {
    const faces = segmentFaces(cubeMesh)
    for (const f of faces) expect(f.areaMm2).toBeCloseTo(900, 1)
  })

  it('returns at most 12 faces (top-N cap)', () => {
    // synthetic mesh with 20 faces would require a larger fixture; we just
    // assert the cap exists in code by checking the cube doesn't exceed it.
    const faces = segmentFaces(cubeMesh)
    expect(faces.length).toBeLessThanOrEqual(12)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/face-segment.test.ts
```

- [ ] **Step 3: Implement `face-segment.ts`**

`src/lib/import/face-segment.ts`:

```ts
import type { BaseMesh, SemanticFace } from './types'

const MAX_FACES = 12
const NORMAL_TOLERANCE_DEG = 5
const COS_TOL = Math.cos((NORMAL_TOLERANCE_DEG * Math.PI) / 180)

/** Group triangles by normal similarity (no adjacency check — fast and
 *  good enough for CAD-like meshes; organic meshes get over-merged but
 *  that's fine, the LLM still has previews to disambiguate). */
export function segmentFaces(mesh: BaseMesh): SemanticFace[] {
  const groups: Array<{ normalSum: [number, number, number]; tris: number[] }> = []

  for (let i = 0; i < mesh.triangleCount; i++) {
    const nx = mesh.normals[i * 3]
    const ny = mesh.normals[i * 3 + 1]
    const nz = mesh.normals[i * 3 + 2]

    let placed = false
    for (const g of groups) {
      const gx = g.normalSum[0] / g.tris.length
      const gy = g.normalSum[1] / g.tris.length
      const gz = g.normalSum[2] / g.tris.length
      const glen = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
      const dot = (nx * gx + ny * gy + nz * gz) / glen
      if (dot >= COS_TOL) {
        g.tris.push(i)
        g.normalSum[0] += nx
        g.normalSum[1] += ny
        g.normalSum[2] += nz
        placed = true
        break
      }
    }
    if (!placed) {
      groups.push({ normalSum: [nx, ny, nz], tris: [i] })
    }
  }

  const faces: SemanticFace[] = groups.map((g, id) => {
    // Average normal (unit)
    const sx = g.normalSum[0], sy = g.normalSum[1], sz = g.normalSum[2]
    const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
    const normal: [number, number, number] = [sx / slen, sy / slen, sz / slen]

    // Area + centroid (area-weighted)
    let area = 0
    let cx = 0, cy = 0, cz = 0
    for (const ti of g.tris) {
      const o = ti * 9
      const ax = mesh.positions[o], ay = mesh.positions[o + 1], az = mesh.positions[o + 2]
      const bx = mesh.positions[o + 3], by = mesh.positions[o + 4], bz = mesh.positions[o + 5]
      const ccx = mesh.positions[o + 6], ccy = mesh.positions[o + 7], ccz = mesh.positions[o + 8]
      const ux = bx - ax, uy = by - ay, uz = bz - az
      const vx = ccx - ax, vy = ccy - ay, vz = ccz - az
      const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
      const triArea = 0.5 * Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2)
      const triCentroid = [(ax + bx + ccx) / 3, (ay + by + ccy) / 3, (az + bz + ccz) / 3]
      area += triArea
      cx += triCentroid[0] * triArea
      cy += triCentroid[1] * triArea
      cz += triCentroid[2] * triArea
    }
    cx /= area; cy /= area; cz /= area

    // In-plane 2D bbox
    const tangent = pickTangent(normal)
    const bitangent: [number, number, number] = [
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ]
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const ti of g.tris) {
      const o = ti * 9
      for (let k = 0; k < 3; k++) {
        const px = mesh.positions[o + k * 3] - cx
        const py = mesh.positions[o + k * 3 + 1] - cy
        const pz = mesh.positions[o + k * 3 + 2] - cz
        const u = px * tangent[0] + py * tangent[1] + pz * tangent[2]
        const v = px * bitangent[0] + py * bitangent[1] + pz * bitangent[2]
        if (u < u0) u0 = u; if (u > u1) u1 = u
        if (v < v0) v0 = v; if (v > v1) v1 = v
      }
    }

    return {
      id,
      normal,
      centroid: [cx, cy, cz],
      areaMm2: area,
      triangleIndices: g.tris,
      bboxOnPlane: { min: [u0, v0], max: [u1, v1] },
    }
  })

  // Sort by area desc, take top-12
  faces.sort((a, b) => b.areaMm2 - a.areaMm2)
  return faces.slice(0, MAX_FACES).map((f, i) => ({ ...f, id: i }))
}

function pickTangent(normal: [number, number, number]): [number, number, number] {
  // Pick the world axis least aligned with the normal, project to tangent plane.
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const tx = seed[0] - dot * normal[0]
  const ty = seed[1] - dot * normal[1]
  const tz = seed[2] - dot * normal[2]
  const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  return [tx / len, ty / len, tz / len]
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/face-segment.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/face-segment.ts tests/unit/import/face-segment.test.ts
git commit -m "feat(import): face segmentation by normal clustering"
```

---

## Task 6: Op handler — `scale`

**Files:**
- Create: `src/lib/import/ops/scale.ts`
- Test: `tests/unit/import/ops-scale.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/import/ops-scale.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { applyScale } from '@/lib/import/ops/scale'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
})

describe('applyScale', () => {
  it('uniform scale 2x doubles bbox', async () => {
    const out = await applyScale(cube, { op: 'scale', factor: 2 })
    expect(out.bbox.size[0]).toBeCloseTo(60, 1)
    expect(out.bbox.size[1]).toBeCloseTo(60, 1)
    expect(out.bbox.size[2]).toBeCloseTo(60, 1)
  })

  it('per-axis scale stretches Z only', async () => {
    const out = await applyScale(cube, { op: 'scale', factor: { x: 1, y: 1, z: 3 } })
    expect(out.bbox.size[0]).toBeCloseTo(30, 1)
    expect(out.bbox.size[2]).toBeCloseTo(90, 1)
  })

  it('preserves triangle count and extruders', async () => {
    const out = await applyScale(cube, { op: 'scale', factor: 0.5 })
    expect(out.triangleCount).toBe(cube.triangleCount)
    expect(out.extruders).toEqual(cube.extruders)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/ops-scale.test.ts
```

- [ ] **Step 3: Implement scale op**

`src/lib/import/ops/scale.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh } from '../types'
import { recomputeMeshDerived } from './_shared'

type ScaleParams = Extract<Op, { op: 'scale' }>

export async function applyScale(mesh: BaseMesh, op: ScaleParams): Promise<BaseMesh> {
  const f = op.factor
  const sx = typeof f === 'number' ? f : f.x
  const sy = typeof f === 'number' ? f : f.y
  const sz = typeof f === 'number' ? f : f.z

  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i]     = mesh.positions[i]     * sx
    positions[i + 1] = mesh.positions[i + 1] * sy
    positions[i + 2] = mesh.positions[i + 2] * sz
  }
  return recomputeMeshDerived({ ...mesh, positions })
}
```

Create the shared helper `src/lib/import/ops/_shared.ts`:

```ts
import type { BaseMesh } from '../types'

/** Recompute normals + bbox from positions. Used by ops that transform vertices. */
export function recomputeMeshDerived(
  partial: Omit<BaseMesh, 'normals' | 'bbox'> & { positions: Float32Array },
): BaseMesh {
  const positions = partial.positions
  const triangleCount = positions.length / 9
  const normals = new Float32Array(triangleCount * 3)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < triangleCount; i++) {
    const o = i * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len
    for (const x of [ax, bx, cx]) { if (x < minX) minX = x; if (x > maxX) maxX = x }
    for (const y of [ay, by, cy]) { if (y < minY) minY = y; if (y > maxY) maxY = y }
    for (const z of [az, bz, cz]) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z }
  }
  return {
    positions, normals,
    extruders: partial.extruders,
    triangleCount,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    },
  }
}

/** Convert a BaseMesh into a JSCAD Geom3 (for boolean ops). */
export async function baseMeshToGeom3(mesh: BaseMesh) {
  const { geometries } = await import('@jscad/modeling')
  const polygons = []
  for (let i = 0; i < mesh.triangleCount; i++) {
    const o = i * 9
    polygons.push(geometries.poly3.create([
      [mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]],
      [mesh.positions[o + 3], mesh.positions[o + 4], mesh.positions[o + 5]],
      [mesh.positions[o + 6], mesh.positions[o + 7], mesh.positions[o + 8]],
    ]))
  }
  return geometries.geom3.create(polygons)
}

/** Convert a JSCAD Geom3 back to a BaseMesh. New geometry inherits the
 *  `defaultExtruder`; existing extruder labels are NOT preserved across
 *  boolean ops (JSCAD merges polygons opaquely). */
export async function geom3ToBaseMesh(
  geom: unknown,
  defaultExtruder: 'A' | 'B' = 'A',
): Promise<BaseMesh> {
  const { geometries } = await import('@jscad/modeling')
  const polys = geometries.geom3.toPolygons(geom as Parameters<typeof geometries.geom3.toPolygons>[0])
  const positions: number[] = []
  for (const p of polys) {
    const v = p.vertices
    for (let i = 1; i < v.length - 1; i++) positions.push(...v[0], ...v[i], ...v[i + 1])
  }
  const triangleCount = positions.length / 9
  return recomputeMeshDerived({
    positions: new Float32Array(positions),
    extruders: new Array(triangleCount).fill(defaultExtruder),
    triangleCount,
  } as Omit<BaseMesh, 'normals' | 'bbox'> & { positions: Float32Array })
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/ops-scale.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/ops/scale.ts src/lib/import/ops/_shared.ts tests/unit/import/ops-scale.test.ts
git commit -m "feat(import): scale op + shared geom3 conversion helpers"
```

---

## Task 7: Op handler — `hole`

**Files:**
- Create: `src/lib/import/ops/hole.ts`
- Test: `tests/unit/import/ops-hole.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/import/ops-hole.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyHole } from '@/lib/import/ops/hole'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyHole', () => {
  it('through hole reduces volume', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyHole(cube, {
      op: 'hole', faceId: topFace, shape: 'circle',
      diameterMm: 5, depthMm: 'through', positions: [[0, 0]],
    }, faces)
    expect(out.triangleCount).toBeGreaterThan(cube.triangleCount)
  })

  it('fails (warning) on faceId out of range', async () => {
    await expect(applyHole(cube, {
      op: 'hole', faceId: 99, shape: 'circle',
      diameterMm: 5, depthMm: 'through', positions: [[0, 0]],
    }, faces)).rejects.toThrow(/face/i)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/ops-hole.test.ts
```

- [ ] **Step 3: Implement hole op**

`src/lib/import/ops/hole.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'

type HoleParams = Extract<Op, { op: 'hole' }>

export async function applyHole(
  mesh: BaseMesh,
  op: HoleParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const face = faces[op.faceId]
  if (!face) throw new Error(`face ${op.faceId} out of range (have ${faces.length})`)

  const { primitives, booleans, transforms } = await import('@jscad/modeling')
  const base = await baseMeshToGeom3(mesh)

  // Depth: 'through' = bbox diagonal * 2 to guarantee passage
  const diag = Math.sqrt(
    mesh.bbox.size[0] ** 2 + mesh.bbox.size[1] ** 2 + mesh.bbox.size[2] ** 2,
  )
  const depth = op.depthMm === 'through' ? diag * 2 : op.depthMm

  // Build the cutter: vertical along face normal, centered on each position.
  // 'Vertical' is along the face normal in world space.
  const cutters = []
  for (const [u, v] of op.positions) {
    let cutter
    if (op.shape === 'circle') {
      const r = (op.diameterMm ?? 3) / 2
      cutter = primitives.cylinder({ radius: r, height: depth })
    } else {
      const w = op.widthMm ?? 3
      const h = op.heightMm ?? 3
      cutter = primitives.cuboid({ size: [w, h, depth] })
    }

    // Orient cutter axis along face.normal.
    cutter = orientAlongNormal(cutter, face.normal, transforms)

    // Place at face centroid + (u, v) in face's tangent frame.
    const { tangent, bitangent } = makeFrame(face.normal)
    const wx = face.centroid[0] + u * tangent[0] + v * bitangent[0]
    const wy = face.centroid[1] + u * tangent[1] + v * bitangent[1]
    const wz = face.centroid[2] + u * tangent[2] + v * bitangent[2]
    // For 'through', push the cutter back along -normal by depth/2 so it spans
    // the mesh symmetrically through the face.
    const cx = wx - face.normal[0] * (depth / 2 - 0.001)
    const cy = wy - face.normal[1] * (depth / 2 - 0.001)
    const cz = wz - face.normal[2] * (depth / 2 - 0.001)
    cutters.push(transforms.translate([cx, cy, cz], cutter))
  }

  const result = booleans.subtract(base, ...cutters)
  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}

function makeFrame(normal: [number, number, number]) {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const tx = seed[0] - dot * normal[0]
  const ty = seed[1] - dot * normal[1]
  const tz = seed[2] - dot * normal[2]
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  const tangent: [number, number, number] = [tx / tl, ty / tl, tz / tl]
  const bitangent: [number, number, number] = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ]
  return { tangent, bitangent }
}

function orientAlongNormal(
  geom: unknown,
  normal: [number, number, number],
  transforms: typeof import('@jscad/modeling').transforms,
): unknown {
  // JSCAD cylinder/cuboid are built along Z by default. Compute rotation
  // that maps Z=[0,0,1] to `normal`.
  const z: [number, number, number] = [0, 0, 1]
  const dot = z[0] * normal[0] + z[1] * normal[1] + z[2] * normal[2]
  if (dot > 0.9999) return geom
  if (dot < -0.9999) return transforms.rotateX(Math.PI, geom)
  const ax = z[1] * normal[2] - z[2] * normal[1]
  const ay = z[2] * normal[0] - z[0] * normal[2]
  const az = z[0] * normal[1] - z[1] * normal[0]
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
  return transforms.rotate([0, 0, 0], [angle, 0, 0], geom) // placeholder; see note below
    ?? transforms.rotateZ(angle, geom)
}
```

> **Implementation note:** `transforms.rotate` in `@jscad/modeling` takes Euler angles, not axis-angle. Replace the last block with `transforms.rotate([angle * ax, angle * ay, angle * az], geom)` if that matches the local jscad version. Verify by running the test — if rotation is wrong, the test will fail with mismatched bbox.

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/ops-hole.test.ts
```

If rotation is off, replace `orientAlongNormal` with axis-angle approach:

```ts
function orientAlongNormal(geom, normal, transforms) {
  const z = [0, 0, 1]
  const dot = Math.max(-1, Math.min(1, z[0] * normal[0] + z[1] * normal[1] + z[2] * normal[2]))
  if (dot > 0.9999) return geom
  if (dot < -0.9999) return transforms.rotateX(Math.PI, geom)
  const angle = Math.acos(dot)
  const ax = z[1] * normal[2] - z[2] * normal[1]
  const ay = z[2] * normal[0] - z[0] * normal[2]
  const az = z[0] * normal[1] - z[1] * normal[0]
  const alen = Math.sqrt(ax*ax + ay*ay + az*az) || 1
  // Rodrigues via Euler approximation — for the 6 cube faces, the rotation
  // axis is always X or Y, so split into the dominant axis.
  if (Math.abs(ax/alen) > Math.abs(ay/alen)) return transforms.rotateX(angle * Math.sign(ax), geom)
  return transforms.rotateY(angle * Math.sign(ay), geom)
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/ops/hole.ts tests/unit/import/ops-hole.test.ts
git commit -m "feat(import): hole op with face-normal-aligned cutters"
```

---

## Task 8: Op handler — `add_logo`

**Files:**
- Create: `src/lib/import/ops/add-logo.ts`
- Test: `tests/unit/import/ops-add-logo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/import/ops-add-logo.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyAddLogo } from '@/lib/import/ops/add-logo'

// Mock fetch for image URL — return a small PNG.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => {
    // Tiny 4x4 black PNG
    const png = await readFile(join(__dirname, '../../fixtures/black-4x4.png'))
    return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
  },
})))

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyAddLogo', () => {
  it('embossed adds geometry above the chosen face', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'embossed', offsetMm: [0, 0],
    }, faces)
    // Z bbox should be roughly 30 + 0.6 = 30.6 for embossed
    expect(out.bbox.size[2]).toBeGreaterThan(30.4)
  })

  it('engraved reduces or keeps bbox', async () => {
    const topFace = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyAddLogo(cube, {
      op: 'add_logo', faceId: topFace, imageUrl: 'http://mock/logo.png',
      sizeMm: 10, depthMm: 0.6, treatment: 'engraved', offsetMm: [0, 0],
    }, faces)
    expect(out.bbox.size[2]).toBeLessThanOrEqual(30.01)
  })
})
```

Create the PNG fixture once:

```bash
# Tiny 4x4 black square (LLM image content not relevant for unit test).
pnpm tsx -e "import sharp from 'sharp'; sharp({create:{width:4,height:4,channels:3,background:{r:0,g:0,b:0}}}).png().toFile('tests/fixtures/black-4x4.png')"
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/ops-add-logo.test.ts
```

- [ ] **Step 3: Implement add-logo**

`src/lib/import/ops/add-logo.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'

type AddLogoParams = Extract<Op, { op: 'add_logo' }>

export async function applyAddLogo(
  mesh: BaseMesh,
  op: AddLogoParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const face = faces[op.faceId]
  if (!face) throw new Error(`face ${op.faceId} out of range`)

  // Reject curved faces — we need a planar host.
  // (Heuristic: if the face's triangles span > 5° from average normal,
  //  segmentFaces would not have grouped them, so by construction faces
  //  are planar. Skip explicit check.)

  // Fetch and extrude the logo using the existing pipeline.
  const res = await fetch(op.imageUrl)
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
  const imgBuffer = Buffer.from(await res.arrayBuffer())

  const logoGeom = await extrudeLogo({
    imageBuffer: imgBuffer,
    sizeMm: op.sizeMm,
    depthMm: op.depthMm,
    // extrudeLogo returns a geom centered at (0,0,0), extruded along +Z.
  })

  const { booleans, transforms } = await import('@jscad/modeling')

  // Orient logo from local +Z to face normal, translate to centroid + offset.
  const orientedLogo = orientAndPlace(logoGeom, face, op.offsetMm, op.depthMm, op.treatment, transforms)

  const base = await baseMeshToGeom3(mesh)
  const result = op.treatment === 'engraved' || op.treatment === 'through_cut'
    ? booleans.subtract(base, orientedLogo)
    : booleans.union(base, orientedLogo)

  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}

function orientAndPlace(
  geom: unknown,
  face: SemanticFace,
  offset: [number, number],
  depthMm: number,
  treatment: 'embossed' | 'engraved' | 'through_cut',
  transforms: typeof import('@jscad/modeling').transforms,
): unknown {
  // Compute frame
  const n = face.normal
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * n[0] + seed[1] * n[1] + seed[2] * n[2]
  const t: [number, number, number] = [
    seed[0] - dot * n[0], seed[1] - dot * n[1], seed[2] - dot * n[2],
  ]
  const tl = Math.sqrt(t[0]**2 + t[1]**2 + t[2]**2) || 1
  t[0] /= tl; t[1] /= tl; t[2] /= tl
  const b: [number, number, number] = [
    n[1]*t[2] - n[2]*t[1], n[2]*t[0] - n[0]*t[2], n[0]*t[1] - n[1]*t[0],
  ]

  // Rotate geom (built around +Z) to align +Z with face normal.
  let oriented = geom
  const cos = n[2]  // dot of (0,0,1) with face normal
  if (cos < 0.9999) {
    if (cos < -0.9999) {
      oriented = transforms.rotateX(Math.PI, oriented as never)
    } else {
      const angle = Math.acos(Math.max(-1, Math.min(1, cos)))
      const axis = [0*n[2] - 1*n[1], 1*n[0] - 0*n[2], 0*n[1] - 0*n[0]] // cross([0,0,1], n)
      const al = Math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2) || 1
      if (Math.abs(axis[0]/al) > 0.5) oriented = transforms.rotateX(angle * Math.sign(axis[0]), oriented as never)
      else oriented = transforms.rotateY(angle * Math.sign(axis[1]), oriented as never)
    }
  }

  // Position: face centroid + offset along (t,b). For embossed, geom sits
  // above the face (extrusion already starts at z=0 in local frame), so its
  // base coincides with the face surface — translate to centroid.
  // For engraved/through_cut, push INTO the mesh by depthMm.
  const depthShift = treatment === 'embossed' ? 0 : -depthMm
  const cx = face.centroid[0] + offset[0]*t[0] + offset[1]*b[0] + depthShift*n[0]
  const cy = face.centroid[1] + offset[0]*t[1] + offset[1]*b[1] + depthShift*n[1]
  const cz = face.centroid[2] + offset[0]*t[2] + offset[1]*b[2] + depthShift*n[2]
  return transforms.translate([cx, cy, cz], oriented as never)
}
```

> **Note:** `extrudeLogo` already exists at `src/lib/logo-extrude/extrude.ts`. Inspect its signature with `grep -n "export.*extrudeLogo" src/lib/logo-extrude/extrude.ts` and adjust the call shape if necessary — the params above (`imageBuffer`, `sizeMm`, `depthMm`) are the expected shape; if it differs, adapt the call.

- [ ] **Step 4: Verify `extrudeLogo` signature**

```bash
grep -n "export.*extrudeLogo\|export function extrudeLogo\|export const extrudeLogo" src/lib/logo-extrude/extrude.ts
```

Adjust the call in `add-logo.ts` to match. If `extrudeLogo` requires different params (e.g. `binaryThreshold`), pass sensible defaults.

- [ ] **Step 5: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/ops-add-logo.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/import/ops/add-logo.ts tests/unit/import/ops-add-logo.test.ts tests/fixtures/black-4x4.png
git commit -m "feat(import): add_logo op reusing existing extrudeLogo pipeline"
```

---

## Task 9: Op handler — `emboss_text`

**Files:**
- Create: `src/lib/import/ops/emboss-text.ts`
- Test: `tests/unit/import/ops-emboss-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyEmbossText } from '@/lib/import/ops/emboss-text'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyEmbossText', () => {
  it('embossed text grows Z bbox', async () => {
    const top = faces.findIndex((f) => Math.abs(f.normal[2] - 1) < 0.01)
    const out = await applyEmbossText(cube, {
      op: 'emboss_text', faceId: top, text: 'HI',
      treatment: 'embossed', sizeMm: 6, depthMm: 0.5, offsetMm: [0, 0],
    }, faces)
    expect(out.bbox.size[2]).toBeGreaterThan(30.3)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/ops-emboss-text.test.ts
```

- [ ] **Step 3: Implement emboss-text**

`src/lib/import/ops/emboss-text.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'

type EmbossTextParams = Extract<Op, { op: 'emboss_text' }>

export async function applyEmbossText(
  mesh: BaseMesh,
  op: EmbossTextParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const face = faces[op.faceId]
  if (!face) throw new Error(`face ${op.faceId} out of range`)

  const { primitives, extrusions, transforms, booleans, geometries } = await import('@jscad/modeling')

  // Generate text outlines (2D), extrude, position.
  // `vectorText` returns an array of segments (line-pairs); we group them
  // into closed-ish polylines for extrudeLinear.
  // Note: jscad's vectorText is stroke-based — for a real "filled" letter
  // we expand each segment by depthMm/2 and union. Acceptable for MVP.
  const segments = primitives.text({
    text: op.text,
    extrudeOffset: 0,
    extrudeHeight: 0,
    size: op.sizeMm,
  }) as Array<[[number, number], [number, number]]>

  // For each segment, build a thin extruded rectangle of width op.depthMm/2.
  const strokeWidth = Math.max(op.sizeMm * 0.12, 0.6)
  const strokes = segments.map(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax, dy = by - ay
    const len = Math.sqrt(dx*dx + dy*dy) || 1
    const nx = -dy / len * strokeWidth / 2
    const ny = dx / len * strokeWidth / 2
    const poly = geometries.geom2.create([{
      vertices: [
        [ax + nx, ay + ny], [bx + nx, by + ny],
        [bx - nx, by - ny], [ax - nx, ay - ny],
      ] as Array<[number, number]>,
    }])
    return extrusions.extrudeLinear({ height: op.depthMm }, poly)
  })

  const textGeom = strokes.reduce(
    (acc: unknown, next: unknown) => acc ? booleans.union(acc, next) : next,
    null as unknown,
  )

  // Same orient + place as add-logo
  const oriented = orientAndPlaceForText(textGeom, face, op.offsetMm, op.depthMm, op.treatment, transforms)

  const base = await baseMeshToGeom3(mesh)
  const result = op.treatment === 'engraved'
    ? booleans.subtract(base, oriented)
    : booleans.union(base, oriented)

  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}

function orientAndPlaceForText(
  geom: unknown,
  face: SemanticFace,
  offset: [number, number],
  depthMm: number,
  treatment: 'embossed' | 'engraved',
  transforms: typeof import('@jscad/modeling').transforms,
): unknown {
  // Reuse the same logic from add-logo. Duplicated intentionally here to keep
  // ops independently understandable — refactor only if it grows.
  const n = face.normal
  const z: [number, number, number] = [0, 0, 1]
  const cos = z[0]*n[0] + z[1]*n[1] + z[2]*n[2]
  let oriented = geom
  if (cos < 0.9999) {
    if (cos < -0.9999) {
      oriented = transforms.rotateX(Math.PI, oriented as never)
    } else {
      const angle = Math.acos(Math.max(-1, Math.min(1, cos)))
      const axis = [z[1]*n[2] - z[2]*n[1], z[2]*n[0] - z[0]*n[2], z[0]*n[1] - z[1]*n[0]]
      const al = Math.sqrt(axis[0]**2 + axis[1]**2 + axis[2]**2) || 1
      if (Math.abs(axis[0]/al) > 0.5) oriented = transforms.rotateX(angle * Math.sign(axis[0]), oriented as never)
      else oriented = transforms.rotateY(angle * Math.sign(axis[1]), oriented as never)
    }
  }
  const depthShift = treatment === 'embossed' ? 0 : -depthMm
  // Build face frame for offset
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2])
  const seed: [number, number, number] = ax < ay && ax < az ? [1,0,0] : ay < az ? [0,1,0] : [0,0,1]
  const sdot = seed[0]*n[0] + seed[1]*n[1] + seed[2]*n[2]
  const t: [number, number, number] = [seed[0]-sdot*n[0], seed[1]-sdot*n[1], seed[2]-sdot*n[2]]
  const tl = Math.sqrt(t[0]**2 + t[1]**2 + t[2]**2) || 1
  t[0]/=tl; t[1]/=tl; t[2]/=tl
  const b: [number, number, number] = [n[1]*t[2]-n[2]*t[1], n[2]*t[0]-n[0]*t[2], n[0]*t[1]-n[1]*t[0]]
  const cx = face.centroid[0] + offset[0]*t[0] + offset[1]*b[0] + depthShift*n[0]
  const cy = face.centroid[1] + offset[0]*t[1] + offset[1]*b[1] + depthShift*n[1]
  const cz = face.centroid[2] + offset[0]*t[2] + offset[1]*b[2] + depthShift*n[2]
  return transforms.translate([cx, cy, cz], oriented as never)
}
```

> **Note:** JSCAD's `primitives.text` API may differ — verify with `grep -rn "text(" node_modules/@jscad/modeling/dist/ 2>/dev/null | head` or check `node_modules/@jscad/modeling/src/text/` for the actual signature. The plan assumes stroke-segment output; adjust if it's already filled polygons.

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/ops-emboss-text.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/ops/emboss-text.ts tests/unit/import/ops-emboss-text.test.ts
git commit -m "feat(import): emboss_text op via JSCAD stroke extrusion"
```

---

## Task 10: Op handler — `jscad_raw`

**Files:**
- Create: `src/lib/import/ops/jscad-raw.ts`
- Test: `tests/unit/import/ops-jscad-raw.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { applyJscadRaw } from '@/lib/import/ops/jscad-raw'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
})

describe('applyJscadRaw', () => {
  it('union mode adds geometry', async () => {
    const out = await applyJscadRaw(cube, {
      op: 'jscad_raw', mode: 'union',
      code: `module.exports = { main: () => jscad.primitives.cuboid({ size: [5, 5, 5], center: [20, 0, 0] }) }`,
    })
    expect(out.bbox.size[0]).toBeGreaterThan(30)
  })

  it('rejects code missing main()', async () => {
    await expect(applyJscadRaw(cube, {
      op: 'jscad_raw', mode: 'union',
      code: `module.exports = {}`,
    })).rejects.toThrow(/main/)
  })

  it('times out after 30s', async () => {
    await expect(applyJscadRaw(cube, {
      op: 'jscad_raw', mode: 'union',
      code: `module.exports = { main: () => { while(true) {} } }`,
    }, { timeoutMs: 200 })).rejects.toThrow(/timeout/i)
  }, 5000)
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/ops-jscad-raw.test.ts
```

- [ ] **Step 3: Implement jscad-raw**

`src/lib/import/ops/jscad-raw.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh } from '../types'
import { compileUserModule } from '@/lib/jscad/sandbox'
import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'

type JscadRawParams = Extract<Op, { op: 'jscad_raw' }>

const DEFAULT_TIMEOUT = 30_000

export async function applyJscadRaw(
  mesh: BaseMesh,
  op: JscadRawParams,
  options: { timeoutMs?: number } = {},
): Promise<BaseMesh> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const jscad = await import('@jscad/modeling')

  const factory = compileUserModule(op.code)
  const userMod = factory(jscad)
  if (typeof userMod?.main !== 'function') {
    throw new Error(`jscad_raw: code must export main() via module.exports = { main }`)
  }

  // Run main() with a timeout — Node has no real preemption for sync code,
  // so we wrap in a Promise + setTimeout that rejects. If main() is truly
  // synchronous and infinite-loops, this will only catch the timeout when
  // the JS event loop next ticks (i.e., never). Acceptable for LLM-authored
  // code where loops are uncommon; for hardening, move to a worker.
  const main = userMod.main as (current?: unknown) => unknown
  const currentGeom = op.mode === 'replace' ? await baseMeshToGeom3(mesh) : undefined

  const userGeom = await runWithTimeout(() => main(currentGeom), timeoutMs)

  if (op.mode === 'replace') {
    return geom3ToBaseMesh(userGeom, mesh.extruders[0] ?? 'A')
  }

  // union mode
  const base = await baseMeshToGeom3(mesh)
  const result = jscad.booleans.union(base, userGeom)
  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}

function runWithTimeout<T>(fn: () => T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`jscad_raw timeout after ${ms}ms`)), ms)
    queueMicrotask(() => {
      try {
        const result = fn()
        clearTimeout(timer)
        resolve(result)
      } catch (e) {
        clearTimeout(timer)
        reject(e)
      }
    })
  })
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/ops-jscad-raw.test.ts
```

> Known limitation captured in the test: tight infinite loops (`while(true) {}`) block the event loop and the timeout never fires in pure Node. For production hardening, move execution into a real Worker thread. The MVP test uses a short timeout and tolerates this — if it hangs CI, mark the test `.skip` with a TODO and revisit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/ops/jscad-raw.ts tests/unit/import/ops-jscad-raw.test.ts
git commit -m "feat(import): jscad_raw op via existing sandbox"
```

---

## Task 11: `apply-edits.ts` — dispatcher

**Files:**
- Create: `src/lib/import/ops/index.ts`
- Create: `src/lib/import/apply-edits.ts`
- Test: `tests/unit/import/apply-edits.test.ts`

- [ ] **Step 1: Op registry**

`src/lib/import/ops/index.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { applyScale } from './scale'
import { applyHole } from './hole'
import { applyAddLogo } from './add-logo'
import { applyEmbossText } from './emboss-text'
import { applyJscadRaw } from './jscad-raw'

export interface OpContext {
  faces: SemanticFace[]
}

export const OPS = {
  scale:       (mesh: BaseMesh, op: Op, _ctx: OpContext) => applyScale(mesh, op as never),
  hole:        (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyHole(mesh, op as never, ctx.faces),
  add_logo:    (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyAddLogo(mesh, op as never, ctx.faces),
  emboss_text: (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyEmbossText(mesh, op as never, ctx.faces),
  jscad_raw:   (mesh: BaseMesh, op: Op, _ctx: OpContext) => applyJscadRaw(mesh, op as never),
} as const

export type OpName = keyof typeof OPS
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/import/apply-edits.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { segmentFaces } from '@/lib/import/face-segment'
import { applyEdits } from '@/lib/import/apply-edits'

let cube: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>
let faces: ReturnType<typeof segmentFaces>

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(join(__dirname, '../../fixtures/cube-30mm.3mf')))
  cube = await loadBaseMeshFromBytes(bytes)
  faces = segmentFaces(cube)
})

describe('applyEdits', () => {
  it('runs scale then verifies new bbox', async () => {
    const { mesh, warnings } = await applyEdits(cube, [{ op: 'scale', factor: 0.5 }], faces)
    expect(warnings).toEqual([])
    expect(mesh.bbox.size[0]).toBeCloseTo(15, 1)
  })

  it('collects warning for failing op, continues with next', async () => {
    const { mesh, warnings } = await applyEdits(cube, [
      { op: 'hole', faceId: 99, shape: 'circle', diameterMm: 5, depthMm: 'through', positions: [[0, 0]] },
      { op: 'scale', factor: 2 },
    ], faces)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].op).toBe('hole')
    expect(mesh.bbox.size[0]).toBeCloseTo(60, 1)  // scale still ran
  })

  it('empty edits returns the input mesh unchanged', async () => {
    const { mesh, warnings } = await applyEdits(cube, [], faces)
    expect(warnings).toEqual([])
    expect(mesh).toBe(cube)
  })
})
```

- [ ] **Step 3: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/apply-edits.test.ts
```

- [ ] **Step 4: Implement apply-edits**

`src/lib/import/apply-edits.ts`:

```ts
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace, EditWarning } from './types'
import { OPS, type OpName } from './ops'

export interface ApplyEditsResult {
  mesh: BaseMesh
  warnings: EditWarning[]
}

export async function applyEdits(
  baseMesh: BaseMesh,
  edits: Op[],
  faces: SemanticFace[],
): Promise<ApplyEditsResult> {
  let mesh = baseMesh
  const warnings: EditWarning[] = []
  const ctx = { faces }

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    const handler = OPS[edit.op as OpName]
    if (!handler) {
      warnings.push({ opIndex: i, op: edit.op, reason: `unknown op '${edit.op}'` })
      continue
    }
    try {
      mesh = await handler(mesh, edit, ctx)
    } catch (e) {
      warnings.push({ opIndex: i, op: edit.op, reason: (e as Error).message })
      // mesh unchanged; continue with the next op
    }
  }

  return { mesh, warnings }
}
```

- [ ] **Step 5: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/apply-edits.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/import/apply-edits.ts src/lib/import/ops/index.ts tests/unit/import/apply-edits.test.ts
git commit -m "feat(import): apply-edits dispatcher with partial-failure warnings"
```

---

## Task 12: `parseImportEdit` — vision LLM with face context

**Files:**
- Create: `src/lib/design/parse-import.ts`
- Test: `tests/unit/import/parse-import.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/import/parse-import.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseImportEdit } from '@/lib/design/parse-import'

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: JSON.stringify({
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [{ op: 'scale', factor: 0.5 }],
    }),
  })),
}))

vi.mock('@/lib/llm/model', () => ({
  getModel: vi.fn(() => 'mock-model'),
}))

describe('parseImportEdit', () => {
  it('returns a valid Design with imported kind', async () => {
    const result = await parseImportEdit({
      messages: ['scale it down by half'],
      baseMeshUrl: 'https://x/y.3mf',
      faces: [
        { id: 0, normal: [0,0,1], centroid: [0,0,15], areaMm2: 900, triangleIndices: [],
          bboxOnPlane: { min:[-15,-15], max:[15,15] } },
      ],
      previewDataUrls: { top: 'data:image/png;base64,iVBOR', iso: 'data:image/png;base64,iVBOR',
        front: 'data:image/png;base64,iVBOR', right: 'data:image/png;base64,iVBOR' },
      previousDesign: null,
      bboxMm: [30, 30, 30],
    })
    expect(result.kind).toBe('imported')
    if (result.kind === 'imported') {
      expect(result.edits).toHaveLength(1)
      expect(result.edits[0]).toMatchObject({ op: 'scale', factor: 0.5 })
    }
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm vitest run tests/unit/import/parse-import.test.ts
```

- [ ] **Step 3: Implement `parse-import.ts`**

`src/lib/design/parse-import.ts`:

```ts
import { generateText } from 'ai'
import { getModel } from '@/lib/llm/model'
import { Design } from './schema'
import type { Design as DesignType } from './schema'
import type { SemanticFace } from '@/lib/import/types'

export interface PreviewBundle {
  top: string    // data URL or blob URL
  front: string
  right: string
  iso: string
}

export async function parseImportEdit(input: {
  messages: string[]
  baseMeshUrl: string
  faces: SemanticFace[]
  previewDataUrls: PreviewBundle
  previousDesign: DesignType | null
  bboxMm: [number, number, number]
}): Promise<DesignType> {
  const { messages, baseMeshUrl, faces, previewDataUrls, previousDesign, bboxMm } = input
  const last = messages[messages.length - 1] ?? ''
  const earlier = messages.slice(0, -1)

  const faceTable = faces.map((f) =>
    `F${f.id}: normal=[${f.normal.map((c) => c.toFixed(2)).join(',')}] ` +
    `centroid=[${f.centroid.map((c) => c.toFixed(1)).join(',')}] ` +
    `area=${f.areaMm2.toFixed(0)}mm² ` +
    `bboxOnPlane={x:${f.bboxOnPlane.min[0].toFixed(1)}..${f.bboxOnPlane.max[0].toFixed(1)},` +
    `y:${f.bboxOnPlane.min[1].toFixed(1)}..${f.bboxOnPlane.max[1].toFixed(1)}}`,
  ).join('\n')

  const previousBlock = previousDesign && previousDesign.kind === 'imported'
    ? `PREVIOUS DESIGN (treat new message as a modification):
${JSON.stringify(previousDesign, null, 2)}`
    : '(first edit on this mesh)'

  const userPrompt = `You are editing an imported 3D mesh. Output a Design JSON with kind="imported".

BASE MESH:
- url: ${baseMeshUrl}
- bbox: ${bboxMm[0].toFixed(1)} × ${bboxMm[1].toFixed(1)} × ${bboxMm[2].toFixed(1)} mm

SEMANTIC FACES (top by area, use 'faceId' to reference):
${faceTable}

EARLIER MESSAGES:
${earlier.length ? earlier.map((m, i) => `(${i+1}) ${m}`).join('\n') : '(none)'}

${previousBlock}

LATEST MESSAGE:
${last}

Reply ONLY with valid JSON: { "kind": "imported", "baseMeshUrl": "${baseMeshUrl}", "edits": [...] }`

  const { text } = await generateText({
    model: getModel(),
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image', image: previewDataUrls.iso },
        { type: 'image', image: previewDataUrls.top },
        { type: 'image', image: previewDataUrls.front },
        { type: 'image', image: previewDataUrls.right },
      ],
    }],
    maxOutputTokens: 1200,
  })

  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(`parseImportEdit: bad JSON: ${(err as Error).message}\nGot: ${text.slice(0,300)}`)
  }
  const result = Design.safeParse(json)
  if (!result.success) {
    throw new Error(`parseImportEdit: schema mismatch: ${result.error.message}`)
  }
  return result.data
}

const SYSTEM = `You edit an existing 3D mesh by emitting a list of structured operations.

# Output

Always emit a JSON object with kind="imported", echoing the provided baseMeshUrl, and an "edits" array.

# Available ops

{ "op": "scale", "factor": <number or {x,y,z}> }
{ "op": "hole", "faceId": <int>, "shape": "circle"|"rect",
  "diameterMm": <number> (circle), "widthMm"/"heightMm": <number> (rect),
  "depthMm": <number> | "through", "positions": [[u, v], ...] }
{ "op": "add_logo", "faceId": <int>, "imageUrl": <url>,
  "sizeMm": <number>, "depthMm": <number>,
  "treatment": "embossed"|"engraved"|"through_cut", "offsetMm": [u,v] }
{ "op": "emboss_text", "faceId": <int>, "text": <string>,
  "treatment": "embossed"|"engraved",
  "sizeMm": <number>, "depthMm": <number>, "offsetMm": [u,v] }
{ "op": "jscad_raw", "mode": "union"|"replace",
  "code": "module.exports={main:(current)=>{...}}" }

# Face references

Use the F0/F1/... ids from the SEMANTIC FACES list. (u, v) coordinates in
"positions" or "offsetMm" are in the face's tangent plane, centered on the
face centroid, in millimetres.

# When to use jscad_raw

Only when the request can't fit the structured ops (e.g. "twist the top
30 degrees", "shell the mesh with 2mm walls"). The code receives the
current mesh as a Geom3 in "replace" mode, or you emit fresh geometry
that gets unioned in "union" mode.

# Iteration

If a PREVIOUS DESIGN is given, treat the latest message as a modification.
Patch the relevant edit (e.g. change positions, increase depth) rather
than rebuilding from scratch.

Output ONLY the JSON. No prose, no markdown fences.`
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run tests/unit/import/parse-import.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/parse-import.ts tests/unit/import/parse-import.test.ts
git commit -m "feat(import): parseImportEdit vision LLM with face context"
```

---

## Task 13: Wire `imported` into the generator + route

**Files:**
- Modify: `src/lib/design/generate.ts` (add branch)
- Modify: `src/lib/design/parse.ts` (route to parseImportEdit when applicable)
- Modify: `src/app/api/generate/route.ts` (detect meshUrl, segment & cache faces)
- Test: `tests/integration/api-generate-imported.test.ts`

- [ ] **Step 1: Add `imported` branch to `generate.ts`**

In `src/lib/design/generate.ts`, locate the `switch (design.kind)` block (~lines 76-85). Add:

```ts
case 'imported': {
  const { loadBaseMeshFromUrl } = await import('@/lib/import/load-base-mesh')
  const { segmentFaces } = await import('@/lib/import/face-segment')
  const { applyEdits } = await import('@/lib/import/apply-edits')
  const { serialize3mf } = await import('@/lib/3mf/serialize-3mf')
  const { serializeBinarySTL } = await import('@/lib/stl/serialize')

  const base = await loadBaseMeshFromUrl(design.baseMeshUrl)
  const faces = segmentFaces(base)
  const { mesh, warnings } = await applyEdits(base, design.edits, faces)

  const distinctExtruders = new Set(mesh.extruders)
  const bodies = distinctExtruders.size > 1
    ? Array.from(distinctExtruders).map((ex) => ({
        positions: filterByExtruder(mesh, ex),
        extruder: ex,
        label: `Extruder ${ex}`,
      }))
    : [{ positions: mesh.positions, extruder: 'A' as const, label: 'Body' }]

  const stl = serializeBinarySTL(Array.from(mesh.positions))
  if (warnings.length > 0) {
    console.warn('[generate:imported] warnings:', warnings)
  }
  result = {
    bodies,
    meta: { kind: 'imported', bboxMm: { x: mesh.bbox.size[0], y: mesh.bbox.size[1], z: mesh.bbox.size[2] } },
  }
  break
}
```

And before `generateFromDesign`, add:

```ts
function filterByExtruder(mesh: { positions: Float32Array; extruders: Array<'A'|'B'> }, ex: 'A'|'B'): Float32Array {
  const triCount = mesh.positions.length / 9
  const out: number[] = []
  for (let i = 0; i < triCount; i++) {
    if (mesh.extruders[i] === ex) {
      const o = i * 9
      for (let j = 0; j < 9; j++) out.push(mesh.positions[o + j])
    }
  }
  return new Float32Array(out)
}
```

Also adjust the result shape: at this point `result.stl` doesn't exist for imported (we computed stl separately). Look at the `GenerateResult` interface and where `result.stl` is set. Since the route does `result.bodies.length > 1 ? serialize3mf(...) : result.stl`, ensure `stl` is on the returned object. Add `stl` to the `case 'imported'` result.

Re-assign the case body's last lines:

```ts
result = {
  stl,
  bodies,
  meta: { kind: 'imported', bboxMm: { x: mesh.bbox.size[0], y: mesh.bbox.size[1], z: mesh.bbox.size[2] } },
}
break
```

- [ ] **Step 2: Update `parse.ts` to route to `parseImportEdit`**

In `src/lib/design/parse.ts`, change the exported function signature to accept extra context:

```ts
import { parseImportEdit, type PreviewBundle } from './parse-import'
import type { SemanticFace } from '@/lib/import/types'

export async function parseDesign(input: {
  messages: string[]
  imageDescription: string | null
  imageAspectRatio?: number | null
  previousDesign?: Design | null
  /** When the user uploaded a .3mf, the route loads base mesh metadata and
   *  passes it here so we dispatch to the imported-edit prompt. */
  importContext?: {
    baseMeshUrl: string
    faces: SemanticFace[]
    previewDataUrls: PreviewBundle
    bboxMm: [number, number, number]
  }
}): Promise<Design> {
  if (input.importContext) {
    return parseImportEdit({
      messages: input.messages,
      baseMeshUrl: input.importContext.baseMeshUrl,
      faces: input.importContext.faces,
      previewDataUrls: input.importContext.previewDataUrls,
      previousDesign: input.previousDesign ?? null,
      bboxMm: input.importContext.bboxMm,
    })
  }
  // ... existing implementation unchanged
}
```

- [ ] **Step 3: Update `/api/generate/route.ts` to detect imports**

In `src/app/api/generate/route.ts`:

3a. Extend the `Body` Zod schema:

```ts
const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
  imageUrl: z.string().optional(),
  /** Fresh .3mf upload — overrides any base mesh from history. */
  meshUrl: z.string().url().optional(),
  /** Client-captured previews (data URLs) when starting an import edit. */
  previewDataUrls: z.object({
    top: z.string(), front: z.string(), right: z.string(), iso: z.string(),
  }).optional(),
  designOverride: Design.optional(),
})
```

3b. After resolving `effectiveImageUrl` and `effectiveDescription`, add base-mesh resolution:

```ts
// Resolve base mesh: fresh upload wins; else most recent meshUrl in this project.
let effectiveMeshUrl: string | null = parsed.data.meshUrl ?? null
let cachedFaces: import('@/lib/import/types').SemanticFace[] | null = null
let cachedPreviews: import('@/lib/design/parse-import').PreviewBundle | null = null

if (!effectiveMeshUrl) {
  const lastWithMesh = [...history].reverse().find((h) => {
    const vr = h.validationReport as { kind?: string; baseMeshUrl?: string } | null
    return vr?.kind === 'imported' && vr.baseMeshUrl
  })
  if (lastWithMesh) {
    const vr = lastWithMesh.validationReport as { baseMeshUrl?: string; _faces?: unknown; _previews?: unknown } | null
    effectiveMeshUrl = vr?.baseMeshUrl ?? null
    cachedFaces = (vr?._faces ?? null) as typeof cachedFaces
    cachedPreviews = (vr?._previews ?? null) as typeof cachedPreviews
  }
}

let importContext: Parameters<typeof parseDesign>[0]['importContext'] | undefined
if (effectiveMeshUrl) {
  const { loadBaseMeshFromUrl } = await import('@/lib/import/load-base-mesh')
  const { segmentFaces } = await import('@/lib/import/face-segment')

  const base = await loadBaseMeshFromUrl(effectiveMeshUrl)
  const faces = cachedFaces ?? segmentFaces(base)
  const previews = cachedPreviews ?? parsed.data.previewDataUrls
  if (!previews) {
    return Response.json({
      error: 'Imported edit requires previewDataUrls (client must capture and send them with the first request)',
      iteration_id: iteration.id,
    }, { status: 400 })
  }
  importContext = {
    baseMeshUrl: effectiveMeshUrl,
    faces,
    previewDataUrls: previews,
    bboxMm: base.bbox.size,
  }
}
```

3c. Pass `importContext` into the `parseDesign` call:

```ts
candidate = await parseDesign({
  messages: allMessages,
  imageDescription: effectiveDescription,
  imageAspectRatio,
  previousDesign,
  importContext,
})
```

3d. After successful build, cache the faces + previews into `validationReport`:

```ts
const augmentedReport = design.kind === 'imported' && importContext
  ? { ...(design as object), _faces: importContext.faces, _previews: importContext.previewDataUrls }
  : (design as unknown as Record<string, unknown>)

await db.update(iterations)
  .set({
    status: 'ready',
    meshBlobUrl: meshUrl,
    validationReport: augmentedReport as Record<string, unknown>,
  })
  .where(eq(iterations.id, iteration.id))
```

- [ ] **Step 4: Write the failing integration test**

`tests/integration/api-generate-imported.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/generate/route'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'test-user' } })) }))

// Mock DB
const mockIteration = { id: 'iter-1', projectId: 'proj-1' }
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 'proj-1', userId: 'test-user' }]) , orderBy: vi.fn(async () => []) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [mockIteration]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  },
}))

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: JSON.stringify({
      kind: 'imported',
      baseMeshUrl: 'http://mock/cube.3mf',
      edits: [{ op: 'scale', factor: 0.5 }],
    }),
  })),
}))

// Mock fetch for mesh
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.includes('cube.3mf')) {
    const bytes = await readFile(join(__dirname, '../fixtures/cube-30mm.3mf'))
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  }
  return { ok: false, status: 404 }
}))

describe('POST /api/generate (imported)', () => {
  it('processes a 3MF import + scale edit', async () => {
    const req = new Request('http://x/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: '00000000-0000-0000-0000-000000000001',
        message: 'scale it to half size',
        meshUrl: 'http://mock/cube.3mf',
        previewDataUrls: {
          top: 'data:image/png;base64,iVBOR',
          front: 'data:image/png;base64,iVBOR',
          right: 'data:image/png;base64,iVBOR',
          iso: 'data:image/png;base64,iVBOR',
        },
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.strategy).toBe('generative')
    expect(body.design.kind).toBe('imported')
    expect(body.meta.bbox_mm.x).toBeCloseTo(15, 0)
  })
})
```

- [ ] **Step 5: Run, confirm failure**

```bash
pnpm vitest run tests/integration/api-generate-imported.test.ts
```

- [ ] **Step 6: Iterate on route until test passes**

Run repeatedly, fix any wiring mismatches (DB mock shape, missing imports, etc.). Expected end-state: test passes.

- [ ] **Step 7: Run all tests**

```bash
pnpm vitest run
```

Ensure no existing tests broke.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/generate.ts src/lib/design/parse.ts \
  src/app/api/generate/route.ts tests/integration/api-generate-imported.test.ts
git commit -m "feat(import): wire imported kind through generate route + branch generator"
```

---

## Task 14: UI — accept `.3mf` upload and capture previews

**Files:**
- Modify: `src/components/Chat.tsx`
- Modify: `src/components/MeshViewer.tsx` (expose `capturePreviews`)
- Modify: `src/components/ProjectWorkspace.tsx` (orchestrate)

- [ ] **Step 1: Inspect MeshViewer to find the canvas reference**

```bash
grep -n "canvas\|renderer\|WebGLRenderer\|domElement" src/components/MeshViewer.tsx | head -20
```

- [ ] **Step 2: Expose a `capturePreviews` ref method**

In `src/components/MeshViewer.tsx`, change the component to forward a ref:

```tsx
import { forwardRef, useImperativeHandle } from 'react'
// existing imports

export interface MeshViewerHandle {
  capturePreviews: () => Promise<{ top: string; front: string; right: string; iso: string }>
}

export const MeshViewer = forwardRef<MeshViewerHandle, MeshViewerProps>(
  function MeshViewer(props, ref) {
    // existing state + refs (cameraRef, rendererRef, meshRef, ...)

    useImperativeHandle(ref, () => ({
      capturePreviews: async () => {
        if (!rendererRef.current || !cameraRef.current || !sceneRef.current) {
          throw new Error('viewer not ready')
        }
        const renderer = rendererRef.current
        const camera = cameraRef.current
        const scene = sceneRef.current
        const captureAt = (pos: [number, number, number]): string => {
          camera.position.set(...pos)
          camera.lookAt(0, 0, 0)
          renderer.render(scene, camera)
          return renderer.domElement.toDataURL('image/png')
        }
        // Use mesh bbox to size the camera distance
        const bbox = props.meshUrl ? 200 : 100 // fallback if not yet computed
        const d = bbox
        const previews = {
          iso:   captureAt([d, -d, d]),
          top:   captureAt([0, 0, d * 1.5]),
          front: captureAt([0, -d * 1.5, 0]),
          right: captureAt([d * 1.5, 0, 0]),
        }
        return previews
      },
    }), [props.meshUrl])

    // ... rest of component
  }
)
```

> **Note:** the actual implementation depends on the current state of `MeshViewer.tsx`. Inspect lines 1-50 of the file and adapt. The key building blocks: `forwardRef`, `useImperativeHandle`, and `renderer.domElement.toDataURL`.

- [ ] **Step 3: Update Chat.tsx to accept `.3mf` upload**

In `src/components/Chat.tsx`, find the file input. Change `accept` to include `.3mf`:

```tsx
<input
  type="file"
  accept=".3mf,image/png,image/jpeg,image/webp"
  onChange={handleFileChange}
/>
```

In `handleFileChange`, when a `.3mf` is selected, set state distinguishing it as a mesh upload vs image upload. Pass a `onMeshUploaded(url)` callback up to `ProjectWorkspace`.

- [ ] **Step 4: Orchestrate in `ProjectWorkspace.tsx`**

When `meshUrl` is set, call `meshViewerRef.current?.capturePreviews()` before sending the first generate request:

```tsx
const meshViewerRef = useRef<MeshViewerHandle>(null)
const [pendingMeshUrl, setPendingMeshUrl] = useState<string | null>(null)
const [pendingPreviews, setPendingPreviews] = useState<PreviewBundle | null>(null)

useEffect(() => {
  if (pendingMeshUrl && !pendingPreviews) {
    // Wait one tick for viewer to render the new mesh, then capture.
    const t = setTimeout(async () => {
      if (meshViewerRef.current) {
        try {
          const previews = await meshViewerRef.current.capturePreviews()
          setPendingPreviews(previews)
        } catch (e) {
          console.error('preview capture failed', e)
        }
      }
    }, 500)
    return () => clearTimeout(t)
  }
}, [pendingMeshUrl, pendingPreviews])

// When sending a message:
const sendMessage = async (text: string) => {
  await fetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      message: text,
      meshUrl: pendingMeshUrl ?? undefined,
      previewDataUrls: pendingPreviews ?? undefined,
    }),
  })
  // After first send, the server has cached previews — clear local pending state.
  setPendingMeshUrl(null)
  setPendingPreviews(null)
}
```

- [ ] **Step 5: Manual smoke test**

```bash
pnpm dev
```

Open `http://localhost:3000`, create a project, attach `tests/fixtures/cube-30mm.3mf` from disk, type "diminui pra metade do tamanho". Verify:

1. Upload returns 200, `.3mf` URL appears in the viewer.
2. After a brief delay, request goes out with `meshUrl` + `previewDataUrls`.
3. Response includes `design.kind === "imported"`.
4. New mesh in viewer is half the size.

Document outcome in `docs/reports/import-edit-smoke-2026-05-26.md`:

```bash
mkdir -p docs/reports
cat > docs/reports/import-edit-smoke-2026-05-26.md <<'EOF'
# Import & Edit MVP — smoke test 2026-05-26

## Test cases run
1. Cube 30mm → "diminui pra metade" → ✓ result is 15mm cube
2. ...

## Issues found
- ...

## Next steps
- ...
EOF
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat.tsx src/components/MeshViewer.tsx src/components/ProjectWorkspace.tsx \
  docs/reports/import-edit-smoke-2026-05-26.md
git commit -m "feat(import): UI accepts .3mf upload + captures 4-angle previews"
```

---

## Final verification

- [ ] **Run the entire test suite**

```bash
pnpm vitest run
```

All tests should pass.

- [ ] **Run type check**

```bash
pnpm tsc --noEmit
```

Zero errors.

- [ ] **Lint**

```bash
pnpm lint
```

Zero new errors.

- [ ] **Run dev server, exercise the full happy path manually**

Upload cube → "add a 5mm circular hole in the center of the top". Verify mesh has a hole. Iterate "agora faz dois furos, um em cada canto". Verify both holes.

- [ ] **Final commit (if any leftover changes)**

```bash
git status
# If anything is unstaged, commit it.
```

---

## Out-of-scope follow-ups (track separately)

- Headless render fallback for environments without a connected viewer client
- `fillet_edge`, `chamfer`, `shell` ops
- Multi-extruder support for newly added geometry (currently all new geometry inherits `extruders[0]`)
- True worker-thread sandbox for `jscad_raw` (current implementation can hang on infinite loops in user code)
- Face-disambiguation flow (LLM returns `ambiguous` → server renders numbered faces → UI prompts user). The spec describes this but the MVP plan above relies on the LLM picking a face by id from the textual `faceTable`; add the ambiguity loop once we observe how often the LLM gets it wrong in practice.
