---
uid: task-044
status: open
priority: normal
scheduled: 2026-05-16
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

# Refactor `/api/generate` for image input

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
