'use client'
import { useState } from 'react'
import { requestFlexify } from './flexify-request'
import type { ChatResult } from './Chat'

/**
 * "Make it flexi" — turns the mesh currently in the viewer into an articulated,
 * print-in-place toy via `POST /api/flexify` (the Rocktopus reference is bundled
 * server-side, so this needs NO Meshy credits — it works on any 3MF).
 *
 * The pipeline runs synchronously in the route (~1-20s), then returns a
 * multi-body 3MF. We hand the result to `onFlexified` (ProjectWorkspace's
 * `onResult`), which reuses the exact same generative hydration path as a normal
 * generation: fetch the mesh → the worker sniffs the 3MF (PK zip) and parses it
 * → the viewer renders the ~41 articulated pieces.
 *
 * Gated on a loaded mesh (`iterationId && stl`), mirroring SliceButton. Flexify
 * needs a `meshBlobUrl`-backed (generative) iteration; if the project's latest
 * ready iteration is parametric-only, the route replies 400 and we surface the
 * message inline rather than guessing on the client.
 */
export default function FlexifyButton({
  projectId,
  iterationId,
  stl,
  onFlexified,
}: {
  projectId: string
  iterationId: string | null
  stl: Uint8Array | null
  /** Hydrates the viewer with the flexified result. May be async (ProjectWorkspace's
   * onResult fetches the mesh + parses the 3MF in a worker) — we await it so the
   * loading state spans the full parse, not just the POST. */
  onFlexified: (r: ChatResult) => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await requestFlexify(projectId)
      // Await hydration: onResult fetches + parses the multi-body 3MF in the
      // single-flight worker. Awaiting keeps the button disabled until the mesh
      // is actually in the viewer, so a fast re-click can't fire a second
      // flexify whose worker job rejects with "Another job is in flight".
      await onFlexified({
        kind: 'generative',
        iterationId: r.iterationId,
        meshUrl: r.meshUrl,
        meshBase64: r.meshBase64,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Flexify needs a 3MF source — the pipeline unzips it via parse3mf, so an
  // STL-backed mesh (e.g. a parametric plate) fails with "invalid zip data".
  // Same PK-zip sniff DownloadStlButton uses; hide the button where it can't run.
  const is3mf = !!stl && stl[0] === 0x50 && stl[1] === 0x4b
  if (!iterationId || !stl || !is3mf) return null

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        className="bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm shadow-soft hover:bg-slate-800 disabled:opacity-50 font-medium transition"
        title="Turn this mesh into an articulated, print-in-place toy (~1-20s)"
      >
        {busy ? 'Flexifying… (~1-20s)' : '🦴 Make it flexi'}
      </button>
      {error && (
        <div className="bg-red-950/80 backdrop-blur border border-red-800 text-red-100 rounded-lg px-3 py-2 text-xs max-w-xs whitespace-pre-wrap">
          {error}
        </div>
      )}
    </div>
  )
}
