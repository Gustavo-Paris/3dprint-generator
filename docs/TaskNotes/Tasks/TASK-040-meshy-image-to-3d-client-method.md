---
uid: task-040
status: done
priority: normal
scheduled: 2026-05-16
completed: 2026-05-16
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

# Meshy image-to-3D client method

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
