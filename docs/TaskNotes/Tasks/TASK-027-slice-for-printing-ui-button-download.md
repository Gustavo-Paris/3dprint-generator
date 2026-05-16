---
uid: task-027
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:4
- slicer
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# "Slice for printing" UI button + download

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
