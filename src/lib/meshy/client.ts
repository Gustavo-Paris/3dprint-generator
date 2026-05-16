import type { MeshyTask, MeshyResult } from './types'

const BASE = 'https://api.meshy.ai/openapi/v2'
const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 45 // 45 × 4s = 180s timeout

/**
 * Generate a 3D mesh from a text prompt using Meshy.ai. Polls until done,
 * downloads the OBJ result, converts to binary STL, returns bytes.
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
  let polls = 0

  // 1. Create task
  const createRes = await fetch(`${BASE}/text-to-3d`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'preview', // 'refine' takes ~5x longer; preview is good enough for v1
      prompt: input.prompt,
      art_style: 'realistic',
      should_remesh: true,
      negative_prompt: 'low poly, blurry',
    }),
  })
  if (!createRes.ok) {
    return { ok: false, error: `Meshy create ${createRes.status}: ${await createRes.text().catch(() => '')}` }
  }
  const { result: taskId } = (await createRes.json()) as { result: string }

  // 2. Poll
  while (polls < MAX_POLLS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    polls++
    const statusRes = await fetch(`${BASE}/text-to-3d/${taskId}`, { headers })
    if (!statusRes.ok) {
      return { ok: false, error: `Meshy poll ${statusRes.status}` }
    }
    const task = (await statusRes.json()) as MeshyTask
    if (task.status === 'SUCCEEDED') {
      const objUrl = task.model_urls?.obj
      if (!objUrl) return { ok: false, error: 'Meshy returned no .obj model_url' }

      // 3. Download OBJ
      const objRes = await fetch(objUrl)
      if (!objRes.ok) return { ok: false, error: `Meshy mesh download ${objRes.status}` }
      const objText = await objRes.text()

      // 4. Convert OBJ → binary STL
      const stl = objToBinarySTL(objText)
      return { ok: true, stl, meta: { task_id: taskId, took_ms: Date.now() - t0 } }
    }
    if (task.status === 'FAILED' || task.status === 'EXPIRED' || task.status === 'CANCELED') {
      return { ok: false, error: `Meshy ${task.status}: ${task.task_error?.message ?? 'unknown'}` }
    }
    // PENDING / IN_PROGRESS — keep polling
  }
  return { ok: false, error: `Meshy timeout after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s` }
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
      // Fan triangulate
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
