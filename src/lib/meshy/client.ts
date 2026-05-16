import type { MeshyTask, MeshyResult, MeshyImageInput } from './types'

const BASE = 'https://api.meshy.ai/openapi/v2'
const POLL_INTERVAL_MS = 4000
const MAX_POLLS_PER_STAGE = 60 // 60 × 4s = 240s per stage (preview or refine)

/**
 * Generate a 3D mesh from a text prompt using Meshy.ai.
 *
 * Runs the full 2-stage flow:
 *   1. POST mode=preview → poll until SUCCEEDED (~30-90s)
 *   2. POST mode=refine + preview_task_id → poll until SUCCEEDED (~2-4min)
 *
 * Why both: preview-only meshes are non-manifold (open edges) and slicers
 * like Bambu Studio reject them with "400 non-manifold edges". Refine
 * stage runs Meshy's remesh + topology cleanup, producing a watertight
 * mesh that's directly printable.
 *
 * Total wall time: ~3-6 minutes.
 */
export async function generateMesh(input: {
  prompt: string
  apiKey: string
}): Promise<MeshyResult> {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    'content-type': 'application/json',
  }
  const t0 = Date.now()

  // Stage 1: preview
  const previewCreate = await fetch(`${BASE}/text-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'preview',
      prompt: input.prompt,
      art_style: 'realistic',
      should_remesh: true,
      negative_prompt: 'low poly, blurry, holes, open edges',
    }),
  })
  if (!previewCreate.ok) {
    return {
      ok: false,
      error: `Meshy preview create ${previewCreate.status}: ${await previewCreate.text().catch(() => '')}`,
    }
  }
  const { result: previewTaskId } = (await previewCreate.json()) as { result: string }

  const previewPoll = await pollUntilDone(previewTaskId, headers)
  if (!previewPoll.ok) return previewPoll

  // Stage 2: refine (uses the preview as input)
  const refineCreate = await fetch(`${BASE}/text-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'refine',
      preview_task_id: previewTaskId,
      enable_pbr: false,
    }),
  })
  if (!refineCreate.ok) {
    return {
      ok: false,
      error: `Meshy refine create ${refineCreate.status}: ${await refineCreate.text().catch(() => '')}`,
    }
  }
  const { result: refineTaskId } = (await refineCreate.json()) as { result: string }

  const refinePoll = await pollUntilDone(refineTaskId, headers)
  if (!refinePoll.ok) return refinePoll

  const objUrl = refinePoll.task.model_urls?.obj
  if (!objUrl) return { ok: false, error: 'Meshy refine returned no .obj model_url' }

  const objRes = await fetch(objUrl)
  if (!objRes.ok) return { ok: false, error: `Meshy mesh download ${objRes.status}` }
  const objText = await objRes.text()

  const stl = objToBinarySTL(objText)
  return { ok: true, stl, meta: { task_id: refineTaskId, took_ms: Date.now() - t0 } }
}

type PollOk = { ok: true; task: MeshyTask }
type PollErr = { ok: false; error: string }

async function pollUntilDone(
  taskId: string,
  headers: Record<string, string>,
): Promise<PollOk | PollErr> {
  for (let i = 0; i < MAX_POLLS_PER_STAGE; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch(`${BASE}/text-to-3d/${taskId}`, { headers })
    if (!res.ok) return { ok: false, error: `Meshy poll ${res.status}` }
    const task = (await res.json()) as MeshyTask
    if (task.status === 'SUCCEEDED') return { ok: true, task }
    if (task.status === 'FAILED' || task.status === 'EXPIRED' || task.status === 'CANCELED') {
      return { ok: false, error: `Meshy ${task.status}: ${task.task_error?.message ?? 'unknown'}` }
    }
  }
  return {
    ok: false,
    error: `Meshy timeout after ${(MAX_POLLS_PER_STAGE * POLL_INTERVAL_MS) / 1000}s on task ${taskId}`,
  }
}

const IMAGE_BASE = 'https://api.meshy.ai/openapi/v1'

/**
 * Generate a 3D mesh from an image using Meshy image-to-3D v1.
 * Same 2-stage shape as text-to-3D: preview → refine.
 * Accepts public image URL or a data: URL (data:image/png;base64,...).
 *
 * Total wall time: ~3-7 minutes for both stages.
 */
export async function generateMeshFromImage(input: MeshyImageInput): Promise<MeshyResult> {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    'content-type': 'application/json',
  }
  const t0 = Date.now()

  // Stage 1: preview
  const previewCreate = await fetch(`${IMAGE_BASE}/image-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_url: input.imageUrl,
      ai_model: 'meshy-6',
      topology: 'triangle',
      target_polycount: 30000,
      should_remesh: true,
      should_texture: false,
    }),
  })
  if (!previewCreate.ok) {
    return {
      ok: false,
      error: `Meshy image preview create ${previewCreate.status}: ${await previewCreate.text().catch(() => '')}`,
    }
  }
  const { result: previewTaskId } = (await previewCreate.json()) as { result: string }
  const previewPoll = await pollImageTask(previewTaskId, headers)
  if (!previewPoll.ok) return previewPoll

  // Stage 2: refine. v1 image-to-3d uses `input_task_id` (not `preview_task_id`
  // like v2 text-to-3d). API parameter naming diverges between versions.
  const refineCreate = await fetch(`${IMAGE_BASE}/image-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'refine',
      input_task_id: previewTaskId,
      enable_pbr: false,
    }),
  })
  if (!refineCreate.ok) {
    return {
      ok: false,
      error: `Meshy image refine create ${refineCreate.status}: ${await refineCreate.text().catch(() => '')}`,
    }
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

async function pollImageTask(
  taskId: string,
  headers: Record<string, string>,
): Promise<{ ok: true; task: MeshyTask } | { ok: false; error: string }> {
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 4000))
    const res = await fetch(`${IMAGE_BASE}/image-to-3d/${taskId}`, { headers })
    if (!res.ok) return { ok: false, error: `Meshy image poll ${res.status}` }
    const task = (await res.json()) as MeshyTask
    if (task.status === 'SUCCEEDED') return { ok: true, task }
    if (task.status === 'FAILED' || task.status === 'EXPIRED' || task.status === 'CANCELED') {
      return { ok: false, error: `Meshy image ${task.status}: ${task.task_error?.message ?? 'unknown'}` }
    }
  }
  return { ok: false, error: `Meshy image timeout on ${taskId}` }
}

/**
 * Minimal OBJ → binary STL converter. Handles `v x y z` and `f a b c [d]` lines.
 * Quads are fan-triangulated. Texture/normal indices are stripped from face refs
 * (`1/2/3` → `1`). No support for negative indices, smoothing groups, or `g` groups
 * beyond ignoring them.
 */
export function objToBinarySTL(obj: string): Uint8Array {
  const verts: [number, number, number][] = []
  const tris: [number, number, number][] = []

  for (const line of obj.split('\n')) {
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/)
      verts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])])
    } else if (line.startsWith('f ')) {
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((p) => parseInt(p.split('/')[0], 10) - 1)
      for (let i = 1; i < idx.length - 1; i++) {
        tris.push([idx[0], idx[i], idx[i + 1]])
      }
    }
  }

  const buf = new ArrayBuffer(84 + 50 * tris.length)
  const dv = new DataView(buf)
  dv.setUint32(80, tris.length, true)
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i]
    const va = verts[a], vb = verts[b], vc = verts[c]
    const base = 84 + i * 50

    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2]
    const wx = vc[0] - va[0], wy = vc[1] - va[1], wz = vc[2] - va[2]
    let nx = uy * wz - uz * wy
    let ny = uz * wx - ux * wz
    let nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    dv.setFloat32(base, nx, true)
    dv.setFloat32(base + 4, ny, true)
    dv.setFloat32(base + 8, nz, true)
    dv.setFloat32(base + 12, va[0], true); dv.setFloat32(base + 16, va[1], true); dv.setFloat32(base + 20, va[2], true)
    dv.setFloat32(base + 24, vb[0], true); dv.setFloat32(base + 28, vb[1], true); dv.setFloat32(base + 32, vb[2], true)
    dv.setFloat32(base + 36, vc[0], true); dv.setFloat32(base + 40, vc[1], true); dv.setFloat32(base + 44, vc[2], true)
    dv.setUint16(base + 48, 0, true)
  }
  return new Uint8Array(buf)
}
