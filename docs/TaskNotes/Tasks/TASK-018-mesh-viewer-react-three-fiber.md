---
uid: task-018
status: done
priority: normal
scheduled: 2026-05-15
completed: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Mesh viewer (react-three-fiber)

**Files:** `src/components/MeshViewer.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Viewer component**

`src/components/MeshViewer.tsx`:

```tsx
'use client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

export default function MeshViewer({ positions }: { positions: Float32Array | null }) {
  const geometry = useMemo(() => {
    if (!positions) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.computeVertexNormals()
    return g
  }, [positions])

  return (
    <Canvas camera={{ position: [80, 80, 80], fov: 40 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[100, 100, 100]} intensity={0.8} />
      <gridHelper args={[200, 20, '#888', '#ddd']} />
      {geometry && (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      )}
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </Canvas>
  )
}
```

- [ ] **Step 2: Wire into workspace**

Replace `src/components/ProjectWorkspace.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects as projectsTable, iterations as iterationsTable } from '@/db/schema'
import Chat from './Chat'
import MeshViewer from './MeshViewer'
import { runInWorker } from '@/lib/jscad/worker-client'

type Project = InferSelectModel<typeof projectsTable>
type Iteration = InferSelectModel<typeof iterationsTable>

export default function ProjectWorkspace({
  project,
  initialHistory,
}: {
  project: Project
  initialHistory: Iteration[]
}) {
  const [code, setCode] = useState<string | null>(
    initialHistory.findLast((it) => it.status === 'ready')?.jscadCode ?? null,
  )
  const [positions, setPositions] = useState<Float32Array | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    setError(null)
    runInWorker(code)
      .then((r) => {
        if (cancelled) return
        if (r.ok) setPositions(r.positions)
        else {
          setPositions(null)
          setError(r.error)
        }
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [code])

  const initialMessages = initialHistory.flatMap((it) => {
    const out: { role: 'user' | 'assistant'; text: string; iterationId?: string }[] = [
      { role: 'user', text: it.userMessage },
    ]
    if (it.jscadCode) out.push({ role: 'assistant', text: it.jscadCode, iterationId: it.id })
    return out
  })

  return (
    <main className="h-screen grid grid-cols-[420px_1fr]">
      <aside className="border-r flex flex-col min-h-0">
        <header className="p-4 border-b">
          <h1 className="font-semibold">{project.title}</h1>
        </header>
        <Chat
          projectId={project.id}
          initial={initialMessages}
          onIterationReady={(_id, c) => setCode(c)}
        />
      </aside>
      <section className="relative bg-gray-50" data-testid="viewer-slot">
        <MeshViewer positions={positions} />
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-50 text-red-900 border border-red-200 rounded p-3 text-xs">
            <strong>JSCAD error:</strong> {error}
          </div>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Manual smoke**

`pnpm dev`, send "a 40mm cube" — a blue cube appears in the viewer within a few seconds. Orbit/zoom works.

- [ ] **Step 4: Commit**

```bash
git add src/components/MeshViewer.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(viewer): three-fiber mesh viewer wired to worker"
```
