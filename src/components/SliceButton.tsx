'use client'
import { useEffect, useState } from 'react'

type SliceMeta = {
  print_time_min: number | null
  filament_g: number | null
  filament_m?: number | null
}
type SliceResponse = { url: string | null; inline_base64: string | null; meta: SliceMeta }

export function fmtPrintTime(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(0)} min` : '—'
}
export function fmtFilament(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)} g` : '—'
}
export function fmtFilamentM(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(2)} m` : '—'
}

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
  // null = not yet checked; false = slicer offline (Slice disabled proactively).
  const [slicerOk, setSlicerOk] = useState<boolean | null>(null)

  // Probe slicer availability once a mesh is ready, so the user learns the
  // slicer is down before clicking rather than after a failed slice.
  useEffect(() => {
    if (!iterationId || !stl) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/slicer-health')
        // Only the slicer's own signal (200 + body.ok) flips us to offline. A
        // non-ok response or a thrown fetch here is an APP-origin problem
        // (session expiry, route 500, blip to our own server) — NOT proof the
        // slicer is down. Stay indeterminate (null → button enabled) and let the
        // /api/slice route be the authoritative gate, instead of falsely blocking.
        if (!res.ok) return
        const body = (await res.json()) as { ok?: boolean }
        if (!cancelled) {
          setSlicerOk(body.ok === true)
          if (body.ok !== true) console.warn('[SliceButton] slicer health reported offline (check SLICER_URL)')
        }
      } catch {
        // App-origin network blip — indeterminate, do not hard-block.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [iterationId, stl])

  async function onClick() {
    if (!iterationId || !stl) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // The route slices the server-persisted mesh for this iteration — we no
      // longer upload client bytes (the server won't trust them).
      const res = await fetch('/api/slice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ iterationId }),
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
    let href: string
    let revokeAfter = false
    if (result.url) {
      href = result.url
    } else if (result.inline_base64) {
      const binary = atob(result.inline_base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'model/3mf' })
      href = URL.createObjectURL(blob)
      revokeAfter = true
    } else {
      return
    }
    const a = document.createElement('a')
    a.href = href
    a.download = `${iterationId}.3mf`
    a.click()
    if (revokeAfter) setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  if (!iterationId || !stl) return null

  return (
    <div className="absolute top-[4.5rem] right-4 flex flex-col items-end gap-2 z-10">
      <button
        onClick={onClick}
        disabled={busy || slicerOk === false}
        title={slicerOk === false ? 'Slicer offline — fatiamento indisponível' : undefined}
        className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 shadow-soft hover:bg-brand-700 transition"
      >
        {busy ? 'Fatiando…' : 'Fatiar para impressão'}
      </button>
      {busy && (
        <div className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 shadow-card max-w-xs">
          Malhas pesadas (logo aplicado) podem levar 1-2 min. Aguarde…
        </div>
      )}
      {slicerOk === false && (
        <div className="bg-amber-950/80 backdrop-blur border border-amber-800 text-amber-100 rounded-lg px-3 py-2 text-xs max-w-xs">
          Serviço de fatiamento indisponível no momento. Tente novamente em instantes.
        </div>
      )}
      {error && (
        <div className="bg-red-950/80 backdrop-blur border border-red-800 text-red-100 rounded-lg px-3 py-2 text-xs max-w-xs whitespace-pre-wrap">
          {error}
        </div>
      )}
      {result && (
        <div className="bg-slate-900/85 backdrop-blur border border-slate-700 rounded-xl p-3 text-xs shadow-card space-y-2 text-slate-200">
          <div>
            <span className="text-slate-400">Tempo de impressão: </span>
            <strong className="text-white">{fmtPrintTime(result.meta.print_time_min)}</strong>
          </div>
          <div>
            <span className="text-slate-400">Filamento: </span>
            <strong className="text-white">{fmtFilament(result.meta.filament_g)} · {fmtFilamentM(result.meta.filament_m)}</strong>
          </div>
          <button
            onClick={download}
            className="w-full bg-emerald-600 text-white rounded-lg px-3 py-2 min-h-11 hover:bg-emerald-500 transition font-medium"
          >
            Baixar 3MF fatiado (perfil genérico — pré-visualização)
          </button>
        </div>
      )}
    </div>
  )
}
