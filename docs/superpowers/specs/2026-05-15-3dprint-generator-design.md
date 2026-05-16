# 3D Print Generator — Design

**Status:** Draft for review
**Date:** 2026-05-15
**Owner:** gustavo.b.paris@gmail.com

## 1. Goal

Internal tool that turns natural-language descriptions and reference photos into 3D-printable files for a Bambu Lab H2D printer. Users iterate on the model through chat until they approve it, then download a ready-to-print 3MF (geometry + sliced G-code).

**Success criteria:**
- Time from "I want a thing" to "ready 3MF" is under 5 minutes for a simple object
- Iteration is conversational — no leaving the chat to edit code or geometry
- Output prints on the H2D without manual repair in Bambu Studio

## 2. Scope

### In scope (MVP)

- Web app — Next.js (App Router) on Vercel, internal allowlist
- Chat-based generation: text + optional image input → 3D model
- In-browser 3D viewer with iteration via follow-up messages
- Multi-extruder support: 2 simultaneous extruders, color-only differentiation, PLA-PLA
- Server-side slicing via OrcaSlicer CLI on Railway, output 3MF for the H2D
- Project persistence: conversations, iterations (versioned), generated files
- Authentication: NextAuth magic-link, email allowlist

### Out of scope

- Public signup, billing, multi-tenant features
- Mixed materials between extruders (PLA + TPU, PVA support, etc.)
- Other printer models or generic slicer profiles
- Direct geometry editing in the viewer (gizmos, drag handles)
- Multi-object projects (1 conversation = 1 object)
- Project sharing between users
- Slicing previews (layer-by-layer) — only summary stats
- Real-time print tracking or printer integration

## 3. Architecture

```
Browser (Next.js client)
  ├─ Chat UI — messages + image upload
  ├─ 3D Viewer — react-three-fiber, orbit/zoom, multi-color render
  └─ JSCAD Web Worker — runs LLM-generated @jscad/modeling code
                        → multi-body mesh + 3MF (with extruder hints)

  ↑↓

Server (Next.js API on Vercel Fluid Compute)
  ├─ /api/generate — Claude 4.7 via Vercel AI Gateway, streaming
  ├─ /api/projects — CRUD for projects + iterations
  ├─ /api/upload — image uploads to Vercel Blob
  └─ /api/slice — proxies to Railway slicer service

  ↑↓

External
  ├─ Postgres (Neon via Vercel Marketplace) — schema below
  ├─ Vercel Blob — images, intermediate 3MF, sliced 3MF
  ├─ Vercel AI Gateway — Claude 4.7 (vision)
  └─ Railway slicer service — Docker, OrcaSlicer CLI
       POST /slice  body: 3MF + extruder config  → sliced 3MF + stats
```

### Key architectural choices

- **LLM-generated code runs in the browser**, not the server. Web Worker sandbox is enough; no server-side code execution, no sandbox infra to maintain.
- **3MF as the canonical exchange format**, not STL. 3MF carries multi-body geometry, per-body metadata, and extruder assignments. STL cannot.
- **Slicer is a separate service** on Railway. OrcaSlicer binary is too heavy for Vercel Functions, and runtime is unpredictable (5s–60s).
- **One conversation = one object.** Iteration history is the version log.

## 4. Generation pipeline

```
1. User sends message (text + optional image)
2. Client POSTs to /api/generate with: { project_id, message, image_blob_url? }
3. Server builds prompt:
   - System: JSCAD API reference (curated), multi-body convention, mm units, watertight rules
   - History: last 10 messages of this project (token cap: 8K)
   - Current code: jscad_code of latest iteration (if iterating)
   - Image: included as multimodal content for Claude
4. Claude streams JSCAD code back (text/event-stream)
5. Client receives full code, posts to Web Worker
6. Worker executes code via @jscad/modeling:
   - Returns array of geometries with metadata { extruder: 'A'|'B', label }
   - Serializes to 3MF via @jscad/io-3mf
7. Worker posts back: { meshes (for viewer), tmf_blob, validation_report }
8. Viewer renders meshes with per-extruder colors
9. New iteration row inserted with jscad_code + tmf_blob_url
```

### Iteration model

- Each new message creates a new iteration row
- LLM generates **full code**, not a diff — simpler, robust against partial edits
- `iterations.parent_iteration_id` builds the version tree
- User can switch to any prior iteration as the "current" (rolls back; new generations branch from there)

### Multi-body / multi-extruder convention

The system prompt teaches the LLM this exact pattern:

```javascript
// Convention: export an array of bodies, each tagged with extruder.
const { cuboid, cylinder } = jscad.primitives
const { translate } = jscad.transforms

const main = () => {
  const body = cuboid({ size: [40, 40, 30] })
  const knob = translate([0, 0, 20], cylinder({ radius: 5, height: 10 }))
  return [
    { geometry: body, extruder: 'A', label: 'body' },
    { geometry: knob, extruder: 'B', label: 'knob' },
  ]
}
module.exports = { main }
```

- Single-color requests: 1 entry, `extruder: 'A'`
- Multi-color requests: 2 entries (max in MVP)
- Worker validates: extruder ∈ {A, B}, geometries non-empty, no NaN dims

## 5. Data model (Drizzle / Postgres)

```ts
users
  id         uuid pk
  email      text unique
  name       text
  created_at timestamptz

projects
  id              uuid pk
  user_id         uuid fk → users.id
  title           text                // auto-set from first message; user-editable
  extruder_config jsonb               // { A: { name: "PLA azul", hex: "#1e90ff" }, B: {...} }
  current_iteration_id uuid           // fk → iterations.id, nullable; deferred FK to avoid cycle
  created_at      timestamptz
  updated_at      timestamptz

iterations
  id                   uuid pk
  project_id           uuid fk → projects.id
  parent_iteration_id  uuid fk → iterations.id  (nullable; null = root)
  user_message         text
  image_blob_url       text             (nullable)
  jscad_code           text
  tmf_blob_url         text             (nullable; intermediate, pre-slice)
  sliced_3mf_blob_url  text             (nullable; populated after /api/slice)
  sliced_meta          jsonb            (nullable; { print_time_min, filament_g, layer_count })
  extruder_assignments jsonb            // [{ body_label, extruder }]
  validation_report    jsonb            // { manifold: bool, warnings: [] }
  status               text             // 'generating' | 'ready' | 'failed' | 'sliced'
  error                text             (nullable)
  created_at           timestamptz
```

Indexes: `iterations(project_id, created_at)`, `projects(user_id, updated_at)`.

## 6. Auth & storage

- **Auth:** NextAuth (Auth.js v5) magic link via Resend. Email allowlist in `AUTH_ALLOWED_EMAILS` env var. No public signup.
- **Sessions:** Database adapter (Drizzle) — sessions in Postgres.
- **Blob storage:** Vercel Blob. URLs are signed with 7-day expiry. Files are namespaced by user_id (`{user_id}/{project_id}/{iteration_id}/...`).
- **Image upload constraints:** ≤5MB, formats: jpeg/png/webp. Validated at API edge.

## 7. Deployment

| Service | Where | Why |
|---|---|---|
| Next.js app | Vercel — Fluid Compute, Node.js 24 | Default modern stack |
| Postgres | Neon (Vercel Marketplace) | Auto-provisioned env vars, branches for preview |
| Vercel Blob | Vercel | Native, signed URLs |
| AI Gateway | Vercel AI Gateway → Claude 4.7 | Built-in fallback, observability, no provider lock-in |
| Slicer | Railway — Docker w/ OrcaSlicer CLI | Cannot run in Vercel Function (binary size + timeout) |

**Slicer service (Railway):**
- Dockerfile based on `ubuntu:24.04` + OrcaSlicer 2.x AppImage + `xvfb-run`
- Express endpoint `POST /slice`:
  - Body: `{ tmf_url, extruder_config }`
  - Downloads 3MF → invokes OrcaSlicer CLI with H2D PLA profile + extruder mapping → uploads sliced 3MF back to Blob → returns `{ sliced_url, meta }`
- Bundled profile file: `profiles/bambu-h2d-pla.json` (exported from OrcaSlicer for H2D)
- Health check `/health` for Railway

**Secrets:** managed via `vercel env` for the app, Railway dashboard for the slicer. Shared: `BLOB_READ_WRITE_TOKEN`, `SLICER_INTERNAL_TOKEN` (HMAC between app ↔ slicer).

## 8. Error handling

| Failure | Detection | Recovery |
|---|---|---|
| LLM produces invalid JSCAD syntax | Worker `try/catch` on `eval` of module | Auto-retry once: re-prompt LLM with the error message inline |
| LLM uses non-existent JSCAD API | `ReferenceError` in worker | Same as above |
| Mesh has non-manifold edges | Worker runs manifold check (`@jscad/modeling/operations/measurements`) | Show warning in UI; do not block slicing but flag |
| Slicer timeout (>2 min) | Railway request timeout | Mark iteration `failed`; show OrcaSlicer stderr to user |
| Slicer rejects 3MF | OrcaSlicer non-zero exit | Surface stderr; user can retry or re-generate |
| Claude rate-limited | AI Gateway 429 | Gateway falls back to next provider (configurable); UI shows "still working" |
| Image >5MB | API edge validation | Reject upload with explicit message |
| Bodies overlap (illegal for multi-extruder) | Worker geometry check | Warn user; let them decide whether to slice anyway |

## 9. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | Prompt builder, JSCAD validator, 3MF serializer wrapper, schema validators |
| Integration | Vitest + Testcontainers | `/api/generate` with mocked LLM response; `/api/slice` against a real OrcaSlicer container with fixture STLs |
| E2E | Playwright | Login → new project → generate cube → iterate → multi-body request → slice → download 3MF |
| Manual | Human review | Visual quality of generated geometry; actual print of representative outputs |

**CI:** GitHub Actions running Vitest + Playwright (headless) on PRs. Slicer container tested in a separate workflow.

**Coverage targets (lift later if needed):** 70% lines on `lib/` and `api/`; viewer + worker covered by E2E only.

## 10. Open questions / risks

| Risk | Mitigation |
|---|---|
| Claude struggles with JSCAD vs OpenSCAD (less training data) | Spike during impl: prompt Claude with 5 representative requests; if quality is bad, fall back to OpenSCAD CLI server-side (different architecture) |
| OrcaSlicer headless on Linux requires `xvfb` and may be fragile | Validate in a Dockerfile spike before committing |
| H2D-specific 3MF format may need quirks the generic 3MF serializer misses | Test round-trip: serialize a known multi-body 3MF in browser, open in Bambu Studio, verify integrity |
| LLM-generated bodies overlap and slicer rejects them | Worker-side overlap detection + clear error UX before slice button is enabled |
| Vercel function cold start eats LLM stream budget | Use Fluid Compute defaults; monitor and tune memory if needed |

## 11. Implementation order (high level — detailed plan in writing-plans)

1. Bootstrap Next.js + Drizzle + NextAuth + Vercel project link
2. Minimal viewer: load hardcoded JSCAD, render in three-fiber
3. `/api/generate` MVP with single-body, no image, hardcoded prompt
4. Add iteration / persistence
5. Multi-body convention + viewer multi-color
6. Slicer service on Railway + integration
7. Image upload + multimodal prompt
8. Polish: validation reports, error UX, project list, auth allowlist
