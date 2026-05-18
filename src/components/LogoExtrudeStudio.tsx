'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Crop box in NATURAL image pixel coordinates.
 */
export interface PixelCropBox {
  left: number
  top: number
  width: number
  height: number
}

export interface StudioResult {
  cropBox: PixelCropBox
  threshold?: number
  forceInvert?: boolean
}

/**
 * Logo Extrude Studio — lets the user inspect and adjust binarization
 * parameters before committing to the full STL extrusion.
 *
 * Layout:
 *   left  → source image with draggable crop rectangle overlay
 *   right → live preview of the B&W image potrace would see
 *   bottom → threshold slider, invert toggle, action buttons
 */
export default function LogoExtrudeStudio({
  imageUrl,
  onExtrude,
  onCancel,
}: {
  imageUrl: string
  onExtrude: (params: StudioResult) => void
  onCancel: () => void
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [crop, setCrop] = useState<PixelCropBox | null>(null)
  const [thresholdMode, setThresholdMode] = useState<'auto' | 'manual'>('auto')
  const [threshold, setThreshold] = useState(180)
  const [detectedThreshold, setDetectedThreshold] = useState<number | null>(null)
  const [invertMode, setInvertMode] = useState<'auto' | 'on' | 'off'>('auto')

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Load natural image dimensions
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      setCrop({ left: 0, top: 0, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = imageUrl
  }, [imageUrl])

  // Debounced preview refresh
  const params = useMemo(
    () => ({
      cropBox: crop,
      threshold: thresholdMode === 'manual' ? threshold : undefined,
      forceInvert: invertMode === 'auto' ? undefined : invertMode === 'on',
    }),
    [crop, thresholdMode, threshold, invertMode],
  )

  useEffect(() => {
    if (!crop || !natural) return
    setPreviewLoading(true)
    setPreviewError(null)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/logo-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({ imageUrl, ...params }),
        })
        if (!res.ok) {
          setPreviewError(`Preview ${res.status}: ${await res.text()}`)
          setPreviewLoading(false)
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const detected = res.headers.get('x-preview-threshold')
        if (detected !== null) setDetectedThreshold(Number(detected))
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setPreviewError((err as Error).message)
        }
      } finally {
        setPreviewLoading(false)
      }
    }, 200) // debounce
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [imageUrl, params, crop, natural])

  // Crop dragging logic
  const cropOverlayRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | null
    startX: number
    startY: number
    startCrop: PixelCropBox
  }>({ mode: null, startX: 0, startY: 0, startCrop: { left: 0, top: 0, width: 0, height: 0 } })

  const displayScale = useMemo(() => {
    if (!natural) return 1
    const maxDisplayW = 480
    return Math.min(1, maxDisplayW / natural.w)
  }, [natural])

  const beginDrag = (mode: NonNullable<typeof dragRef.current.mode>) => (e: React.MouseEvent) => {
    if (!crop) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } }
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', endDrag)
  }
  const onDrag = (e: MouseEvent) => {
    const d = dragRef.current
    if (!d.mode || !natural) return
    const dx = (e.clientX - d.startX) / displayScale
    const dy = (e.clientY - d.startY) / displayScale
    const c = { ...d.startCrop }
    if (d.mode === 'move') {
      c.left = Math.max(0, Math.min(natural.w - c.width, c.left + dx))
      c.top = Math.max(0, Math.min(natural.h - c.height, c.top + dy))
    } else {
      if (d.mode === 'nw' || d.mode === 'sw') {
        const newLeft = Math.max(0, Math.min(c.left + c.width - 10, c.left + dx))
        c.width = c.width - (newLeft - c.left)
        c.left = newLeft
      }
      if (d.mode === 'ne' || d.mode === 'se') {
        c.width = Math.max(10, Math.min(natural.w - c.left, c.width + dx))
      }
      if (d.mode === 'nw' || d.mode === 'ne') {
        const newTop = Math.max(0, Math.min(c.top + c.height - 10, c.top + dy))
        c.height = c.height - (newTop - c.top)
        c.top = newTop
      }
      if (d.mode === 'sw' || d.mode === 'se') {
        c.height = Math.max(10, Math.min(natural.h - c.top, c.height + dy))
      }
    }
    setCrop(c)
  }
  const endDrag = () => {
    dragRef.current.mode = null
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', endDrag)
  }

  const resetCrop = () => {
    if (natural) setCrop({ left: 0, top: 0, width: natural.w, height: natural.h })
  }

  const handleExtrude = () => {
    if (!crop) return
    onExtrude({
      cropBox: crop,
      threshold: thresholdMode === 'manual' ? threshold : undefined,
      forceInvert: invertMode === 'auto' ? undefined : invertMode === 'on',
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-auto flex flex-col">
        <header className="px-5 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Logo Studio — ajuste o que vai virar 3D</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-black text-sm">✕ Cancelar</button>
        </header>

        <main className="p-5 grid grid-cols-2 gap-5 min-h-[400px]">
          {/* Left: source image with crop overlay */}
          <div>
            <div className="text-xs text-gray-600 mb-2 font-medium">Imagem original — arraste para cropar</div>
            {natural ? (
              <div
                className="relative inline-block border border-gray-300 bg-[repeating-conic-gradient(#eee_0%_25%,white_25%_50%)] bg-[length:16px_16px]"
                style={{ width: natural.w * displayScale, height: natural.h * displayScale }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="source"
                  style={{ width: natural.w * displayScale, height: natural.h * displayScale }}
                  draggable={false}
                />
                {crop && (
                  <div
                    ref={cropOverlayRef}
                    onMouseDown={beginDrag('move')}
                    className="absolute border-2 border-amber-500 cursor-move"
                    style={{
                      left: crop.left * displayScale,
                      top: crop.top * displayScale,
                      width: crop.width * displayScale,
                      height: crop.height * displayScale,
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                    }}
                  >
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <div
                        key={corner}
                        onMouseDown={beginDrag(corner)}
                        className="absolute w-3 h-3 bg-amber-500 border border-white"
                        style={{
                          [corner.includes('n') ? 'top' : 'bottom']: -6,
                          [corner.includes('w') ? 'left' : 'right']: -6,
                          cursor: `${corner}-resize`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-400">Carregando imagem…</div>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <button onClick={resetCrop} className="px-2 py-1 border rounded hover:bg-gray-50">
                Resetar crop
              </button>
              {crop && natural && (
                <span className="text-gray-500">
                  {Math.round(crop.width)}×{Math.round(crop.height)}px
                  &nbsp;de {natural.w}×{natural.h}
                </span>
              )}
            </div>
          </div>

          {/* Right: live B&W preview */}
          <div>
            <div className="text-xs text-gray-600 mb-2 font-medium">Preview B&W — o que vai virar 3D</div>
            <div className="border border-gray-300 bg-gray-50 min-h-[200px] flex items-center justify-center">
              {previewLoading && <div className="text-xs text-gray-400">Processando…</div>}
              {previewError && <div className="text-xs text-red-600 p-3">{previewError}</div>}
              {!previewLoading && !previewError && previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: '300px' }} />
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Material = preto · Ar (furo passante) = branco
            </div>
          </div>
        </main>

        {/* Controls */}
        <section className="px-5 py-4 border-t bg-gray-50 grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium">Threshold</label>
              <div className="flex items-center gap-1.5">
                {detectedThreshold !== null && (
                  <button
                    onClick={() => {
                      setThresholdMode('manual')
                      setThreshold(detectedThreshold)
                    }}
                    className="text-[10px] px-1.5 py-0.5 border rounded bg-amber-50 hover:bg-amber-100"
                    title="Aplica o valor detectado pelo Otsu como ponto de partida"
                  >
                    Usar detectado ({detectedThreshold})
                  </button>
                )}
                <select
                  value={thresholdMode}
                  onChange={(e) => setThresholdMode(e.target.value as 'auto' | 'manual')}
                  className="text-xs border rounded px-1 py-0.5"
                >
                  <option value="auto">Auto (Otsu)</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            </div>
            <input
              type="range"
              min={20}
              max={240}
              value={threshold}
              disabled={thresholdMode !== 'manual'}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="text-[10px] text-gray-500 flex justify-between">
              <span>20 (preto extremo)</span>
              <span className="font-mono">
                {thresholdMode === 'manual' ? threshold : `auto = ${detectedThreshold ?? '?'}`}
              </span>
              <span>240 (quase tudo)</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-1">Polaridade</div>
            <div className="flex gap-1 text-xs">
              {(['auto', 'off', 'on'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setInvertMode(mode)}
                  className={`px-2 py-1 border rounded ${
                    invertMode === mode ? 'bg-black text-white border-black' : 'bg-white hover:bg-gray-100'
                  }`}
                >
                  {mode === 'auto' ? 'Auto' : mode === 'off' ? 'Normal' : 'Invertida'}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-gray-500 mt-1">
              Use &quot;Invertida&quot; se o fundo da logo for escuro e o desenho claro.
            </div>
          </div>
        </section>

        <footer className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={handleExtrude}
            disabled={!crop || previewLoading}
            className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Extrudar este recorte
          </button>
        </footer>
      </div>
    </div>
  )
}
