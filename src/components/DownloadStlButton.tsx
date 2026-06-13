'use client'

/**
 * Direct STL download — gives the user the raw mesh for their own slicer
 * (PrusaSlicer, Bambu Studio, OrcaSlicer, etc.) without going through the
 * server-side slicing flow.
 */
export default function DownloadStlButton({
  iterationId,
  stl,
}: {
  iterationId: string | null
  stl: Uint8Array | null
}) {
  if (!iterationId || !stl) return null

  const is3mf = stl[0] === 0x50 && stl[1] === 0x4b

  function download() {
    if (!stl || !iterationId) return
    const type = is3mf ? 'application/octet-stream' : 'model/stl'
    const ext = is3mf ? '3mf' : 'stl'
    const blob = new Blob([new Uint8Array(stl)], { type })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${iterationId}.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  return (
    <button
      onClick={download}
      className="bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm shadow-soft hover:bg-slate-800 font-medium transition"
      title={is3mf ? 'Download raw 3MF for your own slicer' : 'Download raw STL for your own slicer'}
    >
      {is3mf ? 'Download 3MF (Multi-Color)' : 'Download STL'}
    </button>
  )
}
