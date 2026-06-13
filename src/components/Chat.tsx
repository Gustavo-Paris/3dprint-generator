'use client'
import { useRef, useState } from 'react'
import { resultLabel } from '@/lib/chat/result-label'
import { BrandMark } from '@/components/Brand'

/** Starter prompts shown in the empty chat so the workspace isn't a blank panel
 *  (design critique P0-2). Clicking one fills the composer (PT-BR, on purpose). */
const EXAMPLE_PROMPTS = [
  'Porta-lata cilíndrico com meu logo',
  'Plaquinha de mesa 80×40mm com furo',
  'Disco ⌀50mm com logo gravado',
  'Chaveiro retangular 40×20mm',
] as const

/** One-line human summary of a Design JSON for the chat header. */
function designSummary(design: unknown): string {
  if (!design || typeof design !== 'object') return 'desconhecido'
  const d = design as Record<string, unknown>
  const kind = String(d.kind ?? 'desconhecido')
  const parts: string[] = []
  if (kind === 'hollow_cylinder') {
    parts.push(`cilindro vazado ${d.insideDiameterMm}×${d.heightMm}mm`)
    if (d.handle) parts.push('com alça')
  } else if (kind === 'flat_plate') {
    parts.push(`placa ${d.widthMm}×${d.heightMm}×${d.thicknessMm}mm`)
    if (d.hangingHole) parts.push('com furo')
    if (d.standAngleDeg) parts.push(`stand ${d.standAngleDeg}°`)
  } else if (kind === 'disc') {
    parts.push(`disco ⌀${d.diameterMm}×${d.thicknessMm}mm`)
    if (d.hangingRing) parts.push('com ring')
    if (d.hangingHole) parts.push('com furo')
  } else if (kind === 'box') {
    parts.push(`caixa ${d.widthMm}×${d.depthMm}×${d.heightMm}mm`)
  } else {
    parts.push(kind)
  }
  const logo = d.logo as Record<string, unknown> | undefined
  if (logo) {
    const treatment = String(logo.treatment ?? '')
    const sizeRatio = Number(logo.sizeRatio ?? 0)
    parts.push(`logo ${treatment} ${(sizeRatio * 100).toFixed(0)}%`)
  }
  return parts.join(' · ')
}

/** The parametric pipeline always persists strategy:'generative' even for
 *  JSCAD-built primitives, so the badge must come from the design kind, not the
 *  stored strategy: only a 'freeform' design is a real Meshy mesh. */
export function badgeFor(design: unknown): 'meshy' | 'jscad' {
  const kind = (design as { kind?: string } | undefined)?.kind
  return kind === 'freeform' ? 'meshy' : 'jscad'
}

type Msg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
  imageUrl?: string
  /** Parsed Design JSON returned by the LLM (shown collapsible in the chat). */
  design?: unknown
  /** Sanity clamps applied to the LLM's output before geometry was built. */
  designAdjustments?: Array<{ field: string; from: number; to: number }>
  /** Edits the backend skipped or failed (e.g. logo couldn't be applied). */
  warnings?: Array<{ opIndex: number; op: string; reason: string }>
}

export type ChatResult =
  | { kind: 'parametric'; iterationId: string; code: string }
  | { kind: 'generative'; iterationId: string; meshUrl: string | null; meshBase64: string | null }

export type PreviewBundle = { top: string; front: string; right: string; iso: string }

export default function Chat({
  projectId,
  initial,
  initialAttachedImageUrl,
  onResult,
  onMeshUploaded,
  pendingMeshUrl,
  pendingPreviews,
}: {
  projectId: string
  initial: Msg[]
  /** URL of the most recent image used in this project. Auto-attached on mount so
   * follow-up messages iterate on the same image instead of generating from scratch.
   * The user can click the X to clear it before sending. */
  initialAttachedImageUrl?: string | null
  onResult: (r: ChatResult) => void
  /** Called when the user uploads a .3mf file. ProjectWorkspace will load it into
   * the viewer and capture previews before the next send. */
  onMeshUploaded?: (url: string) => void
  /** Active imported mesh URL (set by ProjectWorkspace after a .3mf upload). */
  pendingMeshUrl?: string | null
  /** 4-angle previews captured by the viewer (set by ProjectWorkspace). */
  pendingPreviews?: PreviewBundle | null
}) {
  const [messages, setMessages] = useState<Msg[]>(initial)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  /** When set, user is editing this message's design JSON in an inline panel. */
  const [editingDesign, setEditingDesign] = useState<{
    sourceMsgIndex: number
    jsonText: string
    error: string | null
  } | null>(null)
  const [attachedImage, setAttachedImage] = useState<{ url: string; file: File | null; carried: boolean } | null>(
    initialAttachedImageUrl
      ? { url: initialAttachedImageUrl, file: null, carried: true }
      : null,
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected
    const isMesh = file.name.toLowerCase().endsWith('.3mf')
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Upload ${res.status}: ${await res.text()}`)
      const { url } = (await res.json()) as { url: string }
      if (isMesh) {
        // Notify ProjectWorkspace so it can load the mesh in the viewer and
        // capture previews. Do NOT set attachedImage — the mesh is not an image.
        onMeshUploaded?.(url)
      } else {
        setAttachedImage({ url, file, carried: false })
      }
    } catch (err) {
      console.error('[Chat] upload failed', err)
      setUploadError('Falha no upload. Verifique o arquivo e tente de novo.')
    } finally {
      setUploading(false)
    }
  }

  async function send(opts?: { designOverride?: unknown; messageOverride?: string }) {
    if (!opts?.designOverride && (!draft.trim() && !attachedImage) || busy) return
    const userText = opts?.messageOverride ?? (draft.trim() || (attachedImage ? '(image only)' : ''))
    const imgUrl = attachedImage && !attachedImage.carried ? attachedImage.url : undefined
    const displayImage = attachedImage?.url
    setMessages((m) => [...m, { role: 'user', text: userText, imageUrl: displayImage }])
    if (!opts?.messageOverride) setDraft('')
    setAttachedImage(null)
    setBusy(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: userText,
          imageUrl: imgUrl,
          meshUrl: pendingMeshUrl ?? undefined,
          previewDataUrls: pendingPreviews ?? undefined,
          designOverride: opts?.designOverride,
        }),
      })
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
      const body = (await res.json()) as {
        strategy: 'generative'
        iteration_id: string
        mesh_url: string | null
        mesh_base64: string | null
        design?: unknown
        design_adjustments?: Array<{ field: string; from: number; to: number }>
        warnings?: Array<{ opIndex: number; op: string; reason: string }>
        meta?: {
          kind?: 'hollow_cylinder' | 'flat_plate' | 'disc' | 'box'
          bbox_mm?: { x: number; y: number; z: number }
        }
      }
      const label = resultLabel(body.meta)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: label,
          iterationId: body.iteration_id,
          strategy: 'generative',
          design: body.design,
          designAdjustments: body.design_adjustments,
          warnings: body.warnings,
        },
      ])
      onResult({
        kind: 'generative',
        iterationId: body.iteration_id,
        meshUrl: body.mesh_url,
        meshBase64: body.mesh_base64,
      })
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Erro: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm studio-scroll" data-testid="chat-history">
        {messages.length === 0 && !busy && (
          <div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 ring-1 ring-slate-700">
              <BrandMark className="h-6 w-6" />
            </div>
            <p className="mt-4 font-medium text-slate-100">Vamos criar sua peça</p>
            <p className="mt-1 max-w-xs text-sm text-slate-400">
              Descreva o que quer imprimir ou anexe uma imagem. Comece com um exemplo:
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setDraft(ex)}
                  className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 transition hover:border-brand-500 hover:bg-slate-800 hover:text-white"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            {m.imageUrl && (
              <div className={m.role === 'user' ? 'inline-block' : ''}>
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic user-uploaded URL (Vercel Blob or local /uploads); host not in images.remotePatterns, next/image would throw at runtime */}
                <img
                  src={m.imageUrl}
                  alt="attached"
                  className="max-w-[110px] max-h-[110px] sm:max-w-[150px] sm:max-h-[150px] rounded-lg mb-1 inline-block ring-1 ring-slate-700"
                />
              </div>
            )}
            <div
              className={`inline-block rounded-xl px-3 py-2 max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-800 text-slate-100 font-mono text-xs whitespace-pre-wrap'
              }`}
            >
              {m.text}
            </div>
            {m.role === 'assistant' && m.strategy && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-300 uppercase align-top">
                {badgeFor(m.design) === 'meshy' ? 'imagem' : 'paramétrico'}
              </span>
            )}
            {m.role === 'assistant' && m.designAdjustments && m.designAdjustments.length > 0 && (
              <div className="mt-2 max-w-[90%] border-l-2 border-orange-500 bg-orange-950/40 px-3 py-2 text-left text-[11px]">
                <div className="uppercase tracking-wide text-orange-300 font-semibold mb-1">
                  Ajustes aplicados (LLM saiu da faixa printável)
                </div>
                <ul className="space-y-0.5 text-slate-200">
                  {m.designAdjustments.map((a, k) => (
                    <li key={k} className="font-mono">
                      <span className="text-slate-400">{a.field}</span>: {a.from} → {a.to}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {m.role === 'assistant' && m.warnings && m.warnings.length > 0 && (
              <div className="mt-2 max-w-[90%] border-l-2 border-red-500 bg-red-950/40 px-3 py-2 text-left text-[11px]">
                <div className="uppercase tracking-wide text-red-300 font-semibold mb-1">
                  ⚠ Edições não aplicadas
                </div>
                <ul className="space-y-1 text-slate-200">
                  {m.warnings.map((w, k) => (
                    <li key={k}>
                      <span className="font-mono text-slate-400">{w.op}</span>: {w.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {m.role === 'assistant' && m.design != null && editingDesign?.sourceMsgIndex !== i && (
              <details className="mt-2 max-w-[90%] border-l-2 border-brand-500 bg-brand-950/40 px-3 py-2 text-left">
                <summary className="text-[10px] uppercase tracking-wide text-brand-300 font-semibold cursor-pointer select-none min-h-11 flex items-center">
                  Como interpretamos seu pedido — {designSummary(m.design)}
                </summary>
                <pre className="mt-1.5 text-[11px] text-slate-300 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(m.design, null, 2)}
                </pre>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-400">
                    Pra iterar: peça mudanças concretas (&ldquo;logo maior&rdquo;, &ldquo;vazada&rdquo;).
                  </div>
                  <button
                    onClick={() => setEditingDesign({
                      sourceMsgIndex: i,
                      jsonText: JSON.stringify(m.design, null, 2),
                      error: null,
                    })}
                    className="text-[10px] uppercase tracking-wide text-brand-300 border border-brand-700 rounded px-2 py-0.5 min-h-11 hover:bg-brand-900/50 whitespace-nowrap"
                  >
                    Ajustar parâmetros
                  </button>
                </div>
              </details>
            )}
            {m.role === 'assistant' && editingDesign?.sourceMsgIndex === i && (
              <div className="mt-2 max-w-[90%] border-l-2 border-brand-500 bg-brand-950/40 px-3 py-2 text-left">
                <div className="text-[10px] uppercase tracking-wide text-brand-300 font-semibold mb-1.5">
                  Ajustar parâmetros — aplica direto, sem reinterpretar
                </div>
                <textarea
                  value={editingDesign.jsonText}
                  onChange={(e) => setEditingDesign({
                    ...editingDesign,
                    jsonText: e.target.value,
                    error: null,
                  })}
                  className="w-full font-mono text-[11px] border border-slate-600 rounded p-2 bg-slate-900 text-slate-100"
                  rows={12}
                />
                {editingDesign.error && (
                  <div className="mt-1 text-[11px] text-red-300">{editingDesign.error}</div>
                )}
                <div className="mt-1.5 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => {
                      let parsed: unknown
                      try {
                        parsed = JSON.parse(editingDesign.jsonText)
                      } catch (err) {
                        setEditingDesign({
                          ...editingDesign,
                          error: `JSON inválido: ${(err as Error).message}`,
                        })
                        return
                      }
                      setEditingDesign(null)
                      send({ designOverride: parsed, messageOverride: 'edited design directly' })
                    }}
                    className="text-[11px] bg-brand-600 text-white rounded px-3 py-1 hover:bg-brand-700 disabled:opacity-50"
                  >
                    Aplicar
                  </button>
                  <button
                    onClick={() => setEditingDesign(null)}
                    className="text-[11px] border border-slate-600 text-slate-300 rounded px-3 py-1 hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-brand-400" />
            Gerando…
          </div>
        )}
      </div>

      {pendingMeshUrl && (
        <div className="px-4 pb-2 pt-2 flex items-center gap-2 border-t border-slate-800 bg-violet-950/40">
          <span className="text-lg">📦</span>
          <span className="text-xs text-violet-300 flex-1 truncate">
            {pendingPreviews
              ? '.3mf carregado — previews prontos, pode enviar uma mensagem'
              : '.3mf carregado — aguardando previews do viewer…'}
          </span>
        </div>
      )}

      {attachedImage && (
        <div
          className={`px-4 pb-2 pt-2 flex items-center gap-2 border-t border-slate-800 ${
            attachedImage.carried ? 'bg-slate-800/60' : 'bg-emerald-950/40'
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic user-uploaded URL (Vercel Blob or local /uploads); host not in images.remotePatterns, next/image would throw at runtime */}
          <img
            src={attachedImage.url}
            alt="attached preview"
            className="w-12 h-12 object-cover rounded-lg ring-1 ring-slate-700"
          />
          <span className="text-xs text-slate-300 flex-1 truncate">
            {attachedImage.carried
              ? '↻ imagem de referência — seu texto modifica via text-to-3D'
              : `🆕 upload novo — vai regenerar do zero via image-to-3D (texto será ignorado)`}
          </span>
          <button
            onClick={() => setAttachedImage(null)}
            className="text-slate-400 hover:text-red-400 text-sm px-2 min-h-11 min-w-11"
            aria-label="Remover imagem anexada"
          >
            ✕
          </button>
        </div>
      )}

      {uploadError && (
        <div
          role="alert"
          className="px-4 pb-2 pt-2 flex items-center gap-2 border-t border-slate-800 bg-red-950/50 text-red-200 text-xs"
        >
          <span className="flex-1">{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="px-2 min-h-11 min-w-11 text-red-300 hover:text-red-100"
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}

      <form
        className="p-4 border-t border-slate-800 flex gap-2 bg-slate-900"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".3mf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onFileChange}
          data-testid="chat-file-input"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || uploading}
          className="px-3 py-2 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800 disabled:opacity-50 min-h-11 transition"
          aria-label="Anexar imagem"
          title="Anexar imagem"
        >
          {uploading ? '⏳' : '📎'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='Descreva o que quer criar — ex.: "porta-lata cilíndrico com logo"'
          aria-label="Descreva o que quer criar"
          className="flex-1 border border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500 rounded-lg px-3 py-2 min-h-11 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40"
          disabled={busy}
          data-testid="chat-input"
        />
        <button
          type="submit"
          className="bg-brand-600 text-white rounded-lg px-4 py-2 min-h-11 font-medium transition hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50"
          disabled={busy || uploading || (!draft.trim() && !attachedImage)}
        >
          Enviar
        </button>
      </form>

    </>
  )
}
