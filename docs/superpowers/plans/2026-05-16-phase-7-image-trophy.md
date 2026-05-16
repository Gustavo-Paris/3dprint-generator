# Phase 7 — Image-to-3D + Trophy Composition

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** User uploads an image (logo, sketch, photo) in chat. Meshy's image-to-3D produces the mesh. If the user's text mentions trophy / prize / pedestal / stand keywords, the server composes the result on top of a parametric cylindrical base. Final 3MF prints as a real trophy.

**Architecture:**

```
User message + image upload
  ↓
/api/generate
  ↓
Has image? → YES → Meshy image-to-3d (preview→refine, 3-6min)
                 → if base keywords in text → compose with JSCAD cylindrical base
                 → STL combined → store at /meshes/<id>.stl
              NO  → existing flow (classifier → parametric or generative-text)
  ↓
DB iteration: strategy='generative', imageBlobUrl, meshBlobUrl, baseMode='with_base'|'mesh_only'
  ↓
Browser worker(type:'stl') → viewer → SliceButton → 3MF
```

**Tech Stack:** Meshy v1 image-to-3D endpoint, multipart upload in chat, Node `multipart/form-data` parsing via built-in `Request.formData()`, server-side STL boolean-style composition (concatenate two manifold STLs at known offsets — not real CSG; user-acceptable for trophy use).

**Out of scope (Phase 7.5+):**
- Text plaque (proper font handling needs opentype.js + outline extrusion; punted)
- Multi-color trophy (Phase 2 multi-extruder)
- User-customizable base parameters via UI sliders (text-only for now)
- Image cropping / background removal in browser

**Out-of-band setup:** none new — `MESHY_API_KEY` from Phase 6 covers image-to-3D on the same plan.

---

## File structure

```
3dprint-generator/
├── drizzle/<new migration>           # MODIFY: add baseMode to iterations
├── public/uploads/                   # NEW (gitignored): user-uploaded images
├── src/
│   ├── db/schema.ts                  # MODIFY: add baseMode enum
│   ├── lib/
│   │   ├── meshy/
│   │   │   ├── client.ts             # MODIFY: add generateMeshFromImage()
│   │   │   └── types.ts              # MODIFY: ImageMeshInput
│   │   ├── compose/
│   │   │   ├── trophy-base.ts        # NEW: parametric base JSCAD function
│   │   │   └── stl-compose.ts        # NEW: place mesh on top of base, output binary STL
│   │   └── prompt/
│   │       └── base-detect.ts        # NEW: detect "trophy/prize/pedestal" in user text
│   ├── app/api/
│   │   ├── upload/route.ts           # NEW: POST multipart, save image, return URL
│   │   └── generate/route.ts         # MODIFY: handle image input + composition
│   └── components/
│       ├── Chat.tsx                  # MODIFY: file input + thumbnail + multipart send
│       └── ProjectWorkspace.tsx      # MODIFY: render image thumbnail in history
└── tests/
    ├── unit/
    │   ├── base-detect.test.ts
    │   ├── trophy-base.test.ts
    │   └── stl-compose.test.ts
    └── e2e/
        └── image-trophy-flow.spec.ts
```

---

## Task 1: Schema migration — baseMode

**Files:** `src/db/schema.ts`, generated migration

Add to `iterations`:

```ts
  baseMode: text('base_mode', { enum: ['mesh_only', 'with_base'] }),
```

Nullable (parametric iterations have null). Migration is additive.

```bash
pnpm db:generate
pnpm db:migrate
docker exec 3dgen-postgres psql -U app -d app -c "\d iterations" | grep base_mode
```

Commit: `feat(db): add base_mode to iterations`.

---

## Task 2: Image upload endpoint

**Files:** `src/app/api/upload/route.ts`, `.gitignore`

```ts
// src/app/api/upload/route.ts
import { auth } from '@/auth'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return new Response('No file', { status: 400 })
  if (file.size > MAX_BYTES) return new Response('File too large (>5MB)', { status: 413 })
  if (!ACCEPTED.includes(file.type)) return new Response(`Unsupported type ${file.type}`, { status: 415 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const id = randomUUID()
  const bytes = Buffer.from(await file.arrayBuffer())

  let url: string
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${session.user.id}/uploads/${id}.${ext}`, bytes, {
      access: 'public',
      addRandomSuffix: false,
    })
    url = blob.url
  } else {
    const dir = join(process.cwd(), 'public', 'uploads')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${id}.${ext}`), bytes)
    url = `/uploads/${id}.${ext}`
  }

  return Response.json({ url, content_type: file.type, size: bytes.length })
}
```

Append `public/uploads/` to `.gitignore`.

Commit: `feat(upload): /api/upload accepts multipart image (5MB max, png/jpg/webp)`.

---

## Task 3: Meshy image-to-3D client method

**Files:** `src/lib/meshy/types.ts`, `src/lib/meshy/client.ts`, `tests/unit/meshy-image.test.ts`

Add types:

```ts
// types.ts — append
export type MeshyImageInput = {
  imageUrl: string // public URL OR data: URL
  apiKey: string
}
```

Add to `client.ts`:

```ts
const IMAGE_BASE = 'https://api.meshy.ai/openapi/v1'

/**
 * Generate a 3D mesh from an image using Meshy image-to-3D v1.
 * Same 2-stage shape as text-to-3D: preview → refine.
 * Accepts public image URL or a data: URL (data:image/png;base64,...).
 */
export async function generateMeshFromImage(input: MeshyImageInput): Promise<MeshyResult> {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    'content-type': 'application/json',
  }
  const t0 = Date.now()

  // 1. Preview
  const previewCreate = await fetch(`${IMAGE_BASE}/image-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_url: input.imageUrl,
      ai_model: 'meshy-4',
      topology: 'triangle',
      target_polycount: 30000,
      should_remesh: true,
      should_texture: false, // texture not used for printing
    }),
  })
  if (!previewCreate.ok) {
    return { ok: false, error: `Meshy image preview create ${previewCreate.status}: ${await previewCreate.text().catch(() => '')}` }
  }
  const { result: previewTaskId } = (await previewCreate.json()) as { result: string }
  const previewPoll = await pollImageTask(previewTaskId, headers)
  if (!previewPoll.ok) return previewPoll

  // 2. Refine (image-to-3d also supports refine)
  const refineCreate = await fetch(`${IMAGE_BASE}/image-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'refine',
      preview_task_id: previewTaskId,
      enable_pbr: false,
    }),
  })
  if (!refineCreate.ok) {
    return { ok: false, error: `Meshy image refine create ${refineCreate.status}` }
  }
  const { result: refineTaskId } = (await refineCreate.json()) as { result: string }
  const refinePoll = await pollImageTask(refineTaskId, headers)
  if (!refinePoll.ok) return refinePoll

  const objUrl = refinePoll.task.model_urls?.obj
  if (!objUrl) return { ok: false, error: 'Meshy image refine returned no .obj' }
  const objRes = await fetch(objUrl)
  if (!objRes.ok) return { ok: false, error: `Mesh download ${objRes.status}` }
  const stl = objToBinarySTL(await objRes.text())
  return { ok: true, stl, meta: { task_id: refineTaskId, took_ms: Date.now() - t0 } }
}

async function pollImageTask(taskId: string, headers: Record<string, string>) {
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 4000))
    const res = await fetch(`${IMAGE_BASE}/image-to-3d/${taskId}`, { headers })
    if (!res.ok) return { ok: false as const, error: `Meshy image poll ${res.status}` }
    const task = (await res.json()) as MeshyTask
    if (task.status === 'SUCCEEDED') return { ok: true as const, task }
    if (task.status === 'FAILED' || task.status === 'EXPIRED' || task.status === 'CANCELED') {
      return { ok: false as const, error: `Meshy image ${task.status}: ${task.task_error?.message ?? 'unknown'}` }
    }
  }
  return { ok: false as const, error: `Meshy image timeout on ${taskId}` }
}
```

Add Vitest test similar to existing meshy-client.test.ts but mocking the v1 endpoints. 1 test covering preview→refine→download.

Commit: `feat(meshy): image-to-3D client (v1 endpoint, preview→refine)`.

---

## Task 4: Base-keyword detector

**Files:** `src/lib/prompt/base-detect.ts`, `tests/unit/base-detect.test.ts`

```ts
// base-detect.ts
const KEYWORDS = [
  // pt
  'troféu', 'trofeu', 'prêmio', 'premio', 'pedestal', 'base', 'suporte', 'pódio', 'podio',
  // en
  'trophy', 'prize', 'pedestal', 'stand', 'plinth', 'mount', 'award',
]

const NEGATIVE = [
  'sem base', 'no base', 'apenas a logo', 'just the logo', 'só a logo', 'so a logo',
]

export function detectBaseMode(text: string): 'mesh_only' | 'with_base' {
  const lower = text.toLowerCase()
  if (NEGATIVE.some((n) => lower.includes(n))) return 'mesh_only'
  if (KEYWORDS.some((k) => lower.includes(k))) return 'with_base'
  return 'mesh_only' // default: don't surprise the user with a base they didn't ask for
}
```

Tests:
- `'troféu da logo da empresa'` → `with_base`
- `'logo extrudada'` → `mesh_only`
- `'troféu sem base'` → `mesh_only`
- `'prize stand'` → `with_base`
- `'random text'` → `mesh_only`

Commit: `feat(prompt): detect trophy-base keywords in user text`.

---

## Task 5: Trophy base builder (parametric JSCAD)

**Files:** `src/lib/compose/trophy-base.ts`, `tests/unit/trophy-base.test.ts`

```ts
// trophy-base.ts — runs server-side, no DOM
import * as jscad from '@jscad/modeling'
const { primitives, transforms, booleans, geometries, hulls } = jscad

export type BaseSpec = {
  /** Top diameter — should match the logo's max XY dimension * 1.2 */
  topDiameter: number
  /** Bottom diameter — typically 1.4× the top for a stable tapered base */
  bottomDiameter: number
  /** Total height in mm */
  height: number
}

export function buildTrophyBase(spec: BaseSpec): Uint8Array {
  const seg = 64
  // Bottom cylinder (wider)
  const bottom = primitives.cylinder({
    radius: spec.bottomDiameter / 2,
    height: spec.height * 0.3,
    segments: seg,
  })
  // Middle taper — use hull between two flat circles? simpler: stacked cylinders for now
  const middle = transforms.translate(
    [0, 0, spec.height * 0.3],
    primitives.cylinderElliptic({
      startRadius: [spec.bottomDiameter / 2, spec.bottomDiameter / 2],
      endRadius: [spec.topDiameter / 2, spec.topDiameter / 2],
      height: spec.height * 0.5,
      segments: seg,
    }),
  )
  // Top platform (where the logo will sit)
  const top = transforms.translate(
    [0, 0, spec.height * 0.8],
    primitives.cylinder({
      radius: spec.topDiameter / 2,
      height: spec.height * 0.2,
      segments: seg,
    }),
  )
  const base = booleans.union(bottom, middle, top)
  return geometryToBinarySTL(base)
}

function geometryToBinarySTL(geom: unknown): Uint8Array {
  const { toPolygons } = geometries.geom3
  const polygons = toPolygons(geom as Parameters<typeof toPolygons>[0])
  const positions: number[] = []
  for (const poly of polygons) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      positions.push(...verts[0], ...verts[i], ...verts[i + 1])
    }
  }
  // ... binary STL serialization (reuse serializeBinarySTL from runner.ts — extract to shared util)
  // (See note: refactor to share with src/lib/jscad/runner.ts's serializer)
  throw new Error('extract serializeBinarySTL helper first — see Task 5 step 1')
}
```

**Refactor first**: extract `serializeBinarySTL` from `src/lib/jscad/runner.ts` into a new `src/lib/stl/serialize.ts`, re-export. Use it from both runner.ts and trophy-base.ts.

Tests:
- `buildTrophyBase({ topDiameter: 60, bottomDiameter: 80, height: 30 })` produces non-empty STL with > 0 triangles and reasonable bbox (max ~40mm radius, height ~30mm).

Commit: `feat(compose): parametric trophy base builder + STL serializer shared util`.

---

## Task 6: STL composer

**Files:** `src/lib/compose/stl-compose.ts`, `tests/unit/stl-compose.test.ts`

Place mesh A (the logo, from Meshy) on top of mesh B (the base). This is NOT real CSG union — it's just "concatenate two binary STLs with mesh A offset by Z = base height". The slicer will handle the merge as long as both meshes overlap slightly at the seam (which we ensure with 0.5mm overlap).

```ts
export function composeOnTop(input: {
  top: Uint8Array       // The logo mesh from Meshy
  base: Uint8Array      // The parametric trophy base
  baseHeight: number    // Height of the base — used to offset the top
  scaleTopTo: number    // Target XY dimension for the top piece, in mm
}): Uint8Array {
  // Parse top STL, compute bbox, scale uniformly so max(bbox.x, bbox.y) = scaleTopTo
  // Translate so it sits with min.z at (baseHeight - 0.5), overlap 0.5mm into base
  // Re-serialize together with the base STL
  // ...
}
```

Implementation outline:
1. Parse top STL: read triangle count, extract vertices.
2. Compute bbox of top piece.
3. Compute scale = `scaleTopTo / max(bbox.x, bbox.y)`.
4. Compute translation: center XY at origin; min.z = `baseHeight - 0.5`.
5. Transform every vertex of the top.
6. Concatenate triangles: base triangles + transformed-top triangles.
7. Output binary STL with combined count.

Tests:
- Compose 1-triangle top with 1-triangle base → 2-triangle combined STL with correct offsets.
- Verify bbox of result.

Commit: `feat(compose): stack top mesh on top of base via STL concatenation + scale/translate`.

---

## Task 7: Refactor `/api/generate` for image input

**Files:** `src/app/api/generate/route.ts`

Extend the route to accept optional `imageUrl` field in the JSON body:

```ts
const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
  imageUrl: z.string().optional(), // URL from /api/upload
})
```

New branch logic:

```ts
if (parsed.data.imageUrl) {
  // Image flow — always generative, skip classifier
  const strategy = 'generative' as const
  const baseMode = detectBaseMode(message)

  const [iteration] = await db.insert(iterations).values({
    projectId, userMessage: message, status: 'generating',
    strategy, imageBlobUrl: parsed.data.imageUrl, baseMode,
  }).returning()

  const result = await generateMeshFromImage({
    imageUrl: parsed.data.imageUrl,
    apiKey: process.env.MESHY_API_KEY!,
  })
  if (!result.ok) { /* mark failed, return 502 */ }

  let finalStl: Uint8Array = result.stl
  if (baseMode === 'with_base') {
    const baseSpec = inferBaseDimsFromMesh(result.stl) // bbox-based defaults
    const baseStl = buildTrophyBase(baseSpec)
    finalStl = composeOnTop({
      top: result.stl,
      base: baseStl,
      baseHeight: baseSpec.height,
      scaleTopTo: baseSpec.topDiameter * 0.85,
    })
  }

  // ... persist mesh + return same shape as Phase 6 generative response
}
```

`inferBaseDimsFromMesh`: parse STL bbox, set:
- `topDiameter = max(bbox.x, bbox.y) * 1.2`
- `bottomDiameter = topDiameter * 1.3`
- `height = max(20, bbox.z * 0.5)` — at least 20mm, otherwise 50% of logo height

Existing parametric and generative-text-only paths stay unchanged.

Commit: `feat(api): image-to-3D path with optional trophy base composition`.

---

## Task 8: Chat UI — file input + thumbnail

**Files:** `src/components/Chat.tsx`

- Add a paperclip / image icon button next to the text input
- On click, opens file picker (accept="image/*")
- Selected file shows as a thumbnail above the input with an X to remove
- On submit: if image present, POST to `/api/upload` first, get URL, then POST to `/api/generate` with `imageUrl` included
- Disable send while uploading
- Assistant message in chat history shows the source image thumbnail when iteration has `imageBlobUrl`

Use react-hook-form is overkill; just `useState` for the file + URL state. The `initial` prop now includes optional `imageUrl` on user messages.

Commit: `feat(chat): image upload + thumbnail in chat history`.

---

## Task 9: ProjectWorkspace — render image in history

**Files:** `src/components/ProjectWorkspace.tsx`

Initial history hydration: for each iteration with `imageBlobUrl`, render the user message as `<img src={imageBlobUrl} className="max-w-[200px] rounded">` + the text.

The viewer + SliceButton logic stays the same — they only care about positions + STL.

Commit: `feat(workspace): show source image in chat history`.

---

## Task 10: E2E test

**Files:** `tests/e2e/image-trophy-flow.spec.ts`

Mocks `/api/upload` to return a URL, then mocks `/api/generate` to return a generative response. Uploads a tiny PNG fixture, expects:
- Image thumbnail visible in chat history
- Strategy badge `meshy`
- Canvas renders

Commit: `test(e2e): image upload → trophy flow with mocked Meshy`.

---

## Task 11: Manual smoke (human)

1. Bring all infra up (`docker compose up -d`, `pnpm dev`)
2. Login, create project "Trofeu logo"
3. Click attach → upload your company logo (PNG)
4. Type "troféu da nossa logo" → send
5. Wait ~5-7min (image-to-3D 2-stage + composition)
6. Viewer renders: logo extruded on top of cylindrical base
7. Slice for printing → 3MF
8. Open in Bambu Studio — should import cleanly (no manifold errors thanks to refine + clean parametric base)

If manifold errors persist, surface stderr — the issue is likely the seam between top and base where they overlap (0.5mm overlap may not be enough; bump to 1-2mm).

---

## Phase 7 — Done criteria

- [ ] Chat has file attach button; uploaded image shows as thumbnail
- [ ] Submitting with image bypasses the text classifier and routes to image-to-3D
- [ ] Text "troféu da logo" + image → mesh + base composition; just "logo" + image → mesh only
- [ ] Iterations rows have `imageBlobUrl` and `baseMode` populated
- [ ] Sliced 3MF imports into Bambu Studio without manifold errors
- [ ] All vitest + Playwright tests pass

## What's next (Phase 7.5+)

- **Text plaque** on the front face of the base, with proper TTF font handling (`opentype.js` → outline → extrusion). Adds ~5h.
- **User-tunable base parameters** via simple UI (height, diameter sliders) — currently inferred from logo bbox.
- **Background removal** in browser before sending to Meshy (improves logo extraction).
- **Multi-color trophy** when multi-extruder lands (Phase 2 from the original spec, still queued).
