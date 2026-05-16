---
uid: task-035
status: open
priority: normal
scheduled: 2026-05-16
pomodoros: 0
contexts:
- phase:6
- meshy
- hybrid
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Client wiring — Chat + Workspace handle both paths

**Files:** `src/components/Chat.tsx`, `src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Update Chat.tsx**

Rewrite `send()` and message types to handle JSON responses with both shapes:

```tsx
type Msg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
  meshBase64?: string
  meshUrl?: string
}

// Inside send(), replace the fetch + body parsing:
const res = await fetch('/api/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId, message: userText }),
})
if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
const body = (await res.json()) as
  | { strategy: 'parametric'; iteration_id: string; jscad_code: string }
  | { strategy: 'generative'; iteration_id: string; mesh_url: string | null; mesh_base64: string | null; meta: { task_id: string; took_ms: number } }

if (body.strategy === 'parametric') {
  setMessages((m) => [
    ...m,
    { role: 'assistant', text: body.jscad_code, iterationId: body.iteration_id, strategy: 'parametric' },
  ])
  onResult({ kind: 'parametric', iterationId: body.iteration_id, code: body.jscad_code })
} else {
  setMessages((m) => [
    ...m,
    {
      role: 'assistant',
      text: `Generated via Meshy in ${(body.meta.took_ms / 1000).toFixed(0)}s`,
      iterationId: body.iteration_id,
      strategy: 'generative',
      meshUrl: body.mesh_url ?? undefined,
      meshBase64: body.mesh_base64 ?? undefined,
    },
  ])
  onResult({
    kind: 'generative',
    iterationId: body.iteration_id,
    meshUrl: body.mesh_url ?? null,
    meshBase64: body.mesh_base64 ?? null,
  })
}
```

The `onIterationReady` callback prop is now `onResult` with a discriminated union — update the prop type accordingly. Add a tiny pill-style badge next to assistant messages showing `parametric` or `generative`:

```tsx
{m.role === 'assistant' && m.strategy && (
  <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-700 uppercase">
    {m.strategy === 'generative' ? 'meshy' : 'jscad'}
  </span>
)}
```

- [ ] **Step 2: Update ProjectWorkspace.tsx**

The workspace now receives either a `code` or a `meshUrl`/`meshBase64` from the chat. Update the state and the worker call:

```tsx
const onResult = async (r:
  | { kind: 'parametric'; iterationId: string; code: string }
  | { kind: 'generative'; iterationId: string; meshUrl: string | null; meshBase64: string | null }
) => {
  setIterationId(r.iterationId)
  setError(null)
  if (r.kind === 'parametric') {
    const result = await runInWorker({ type: 'jscad', code: r.code })
    if (result.ok) {
      setPositions(result.positions)
      setStl(result.stl)
    } else setError(result.error)
  } else {
    let stlBytes: Uint8Array
    if (r.meshUrl) {
      const res = await fetch(r.meshUrl)
      stlBytes = new Uint8Array(await res.arrayBuffer())
    } else if (r.meshBase64) {
      const binary = atob(r.meshBase64)
      stlBytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) stlBytes[i] = binary.charCodeAt(i)
    } else {
      setError('Generative result has no mesh URL or inline bytes')
      return
    }
    const result = await runInWorker({ type: 'stl', stl: stlBytes })
    if (result.ok) {
      setPositions(result.positions)
      setStl(stlBytes)
    } else setError(result.error)
  }
}
```

Initial history hydration: when an iteration has `strategy === 'generative'`, hydrate by fetching its `meshBlobUrl` and parsing the STL. For `'parametric'`, run the saved `jscadCode` through the worker as before.

- [ ] **Step 3: tsc clean**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx src/components/ProjectWorkspace.tsx
git commit -m "feat(ui): dispatch worker on parametric vs generative result"
```
