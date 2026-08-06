'use client'

/**
 * Unified export control — one entry point for the three outcomes the user
 * cares about, named by result (audit: three parallel downloads with no hierarchy).
 *
 * 1. Mesh crua (STL or 3MF already on the client)
 * 2. 3MF multi-cor com perfil de impressão (client serialize of painted mesh)
 * 3. Hint that sliced estimate lives under "Fatiar para impressão"
 */

export type ExportMenuProps = {
  iterationId: string | null
  stl: Uint8Array | null
  /** Painted mesh available for multi-colour 3MF with print profile. */
  canExportMulticolor: boolean
  multicolorBusy?: boolean
  onExportMulticolor?: () => void | Promise<void>
  /** When true, multi-colour export needs save first for slice — info only. */
  paintDirty?: boolean
}

export function exportOptionLabels(input: {
  is3mf: boolean
  canExportMulticolor: boolean
}): { raw: string; multicolor: string; slicedHint: string } {
  return {
    raw: input.is3mf ? '3MF cru (seu slicer)' : 'STL cru (seu slicer)',
    multicolor: input.canExportMulticolor
      ? '3MF multi-cor com perfil'
      : '3MF multi-cor (pinte ou salve pintura primeiro)',
    slicedHint: '3MF fatiado → use o botão Fatiar (estimativa mono)',
  }
}

export default function ExportMenu({
  iterationId,
  stl,
  canExportMulticolor,
  multicolorBusy,
  onExportMulticolor,
  paintDirty,
}: ExportMenuProps) {
  if (!iterationId || !stl) return null

  const is3mf = stl[0] === 0x50 && stl[1] === 0x4b
  const labels = exportOptionLabels({ is3mf, canExportMulticolor })

  function downloadRaw() {
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
    <details className="relative group" data-testid="export-menu">
      <summary
        className="list-none cursor-pointer bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm shadow-soft hover:bg-slate-800 font-medium transition min-h-11 inline-flex items-center gap-1"
        data-testid="export-menu-trigger"
      >
        ⬇ Exportar
        <span className="text-slate-400 text-xs" aria-hidden>
          ▾
        </span>
      </summary>
      <div
        role="menu"
        className="absolute left-0 z-20 mt-1 min-w-[16rem] rounded-xl border border-slate-700 bg-slate-900/95 p-1 shadow-lift backdrop-blur"
      >
        <button
          type="button"
          role="menuitem"
          data-testid="export-raw"
          onClick={downloadRaw}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
        >
          {labels.raw}
        </button>
        <button
          type="button"
          role="menuitem"
          data-testid="export-multicolor"
          disabled={!canExportMulticolor || multicolorBusy}
          onClick={() => void onExportMulticolor?.()}
          title={
            canExportMulticolor
              ? 'Exporta 3MF multi-cor com perfil Bambu no arquivo'
              : 'Disponível após pintar (ou com malha multi-cor no viewer)'
          }
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {multicolorBusy ? 'Exportando multi-cor…' : labels.multicolor}
        </button>
        <p
          className="px-3 py-2 text-[11px] leading-snug text-slate-500 border-t border-slate-800 mt-1"
          data-testid="export-sliced-hint"
        >
          {labels.slicedHint}
          {paintDirty ? ' · pintura local ainda não salva' : ''}
        </p>
      </div>
    </details>
  )
}
