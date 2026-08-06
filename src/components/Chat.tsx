'use client'
import { useEffect, useRef, useState } from 'react'
import { resultLabel } from '@/lib/chat/result-label'
import { extractApiError } from '@/lib/http/client-error'
import { BrandMark } from '@/components/Brand'
import {
  detectLsfIntent,
  DEFAULT_LSF_SCALE,
  DEFAULT_LSF_MIN_T_MM,
  LSF_SCALE_PRESETS,
} from '@/lib/lsf/detect-intent'
import { lsfProgressLabel } from '@/lib/lsf/progress'

/** Starter prompts shown in the empty chat so the workspace isn't a blank panel
 *  (design critique P0-2). Clicking one fills the composer (PT-BR, on purpose). */
const EXAMPLE_PROMPTS = [
  'Porta-lata cilíndrico com meu logo',
  'Plaquinha de mesa 80×40mm com furo',
  'Disco ⌀50mm com logo gravado',
  'Chaveiro retangular 40×20mm',
  'Maquete LSF a partir de IFC',
] as const

/** When the project already has an imported base mesh, from-scratch prompts are
 *  misleading — the message will EDIT the base. Show edit examples instead
 *  (audit P1: imported ops are undiscoverable). */
const EDIT_PROMPTS = [
  'aumenta 20%',
  'furo de 5mm no topo',
  'texto "MARCI" em relevo na frente',
  'pinta o topo de verde',
] as const

/** Empty-chat example chips — edit examples when an imported base exists. */
export function examplePromptsFor(hasImportedBase: boolean): readonly string[] {
  return hasImportedBase ? EDIT_PROMPTS : EXAMPLE_PROMPTS
}

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
  } else if (kind === 'parametric_code') {
    const spec = String(d.spec ?? '')
    parts.push(`peça sob medida — ${spec.length > 90 ? `${spec.slice(0, 90)}…` : spec}`)
  } else if (kind === 'imported') {
    parts.push('importado')
    const edits = Array.isArray(d.edits) ? d.edits as Array<Record<string, unknown>> : []
    const fromImg = edits.filter((e) => e.op === 'paint_from_image')
    const brushes = edits.filter((e) => e.op === 'paint_brush')
    const paints = edits.filter((e) => e.op === 'paint_region')
    if (fromImg.length > 0) {
      parts.push('multi-cor da imagem')
    } else if (brushes.length > 0) {
      const last = brushes[brushes.length - 1]
      const tool = last.mode === 'fill' ? 'balde' : 'pincel'
      parts.push(`${tool}×${brushes.length}`)
    } else if (paints.length > 0) {
      const p = paints[paints.length - 1]
      const region = p.region ? String(p.region) : p.faceIds ? 'faces' : p.zFraction ? 'faixa-z' : 'região'
      parts.push(`multi-cor ${region}→${p.extruder ?? 'B'}`)
    } else if (edits.length > 0) {
      parts.push(`${edits.length} edit(s)`)
    }
  } else if (kind === 'lsf_maquette') {
    const scale = d.scale != null ? `1:${d.scale}` : '1:70'
    parts.push(`maquete LSF ${scale}`)
    if (d.minTMm != null) parts.push(`min ${d.minTMm}mm`)
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

/** Human-readable lines for the "Como interpretamos seu pedido" disclosure.
 *  The raw Design JSON only renders in dev (inside a nested <details>). */
export function designDetails(design: unknown): string[] {
  if (!design || typeof design !== 'object') return []
  const d = design as Record<string, unknown>
  const kind = String(d.kind ?? '')
  const KIND_LABELS: Record<string, string> = {
    hollow_cylinder: 'Cilindro vazado',
    flat_plate: 'Placa',
    disc: 'Disco',
    box: 'Caixa',
    imported: 'Malha importada (edições sobre o arquivo)',
    parametric_code: 'Peça sob medida (código paramétrico gerado por IA)',
    freeform: 'Forma livre (gerada por IA)',
    flexified: 'Brinquedo articulado',
    lsf_maquette: 'Maquete LSF (esqueleto steel frame a partir de IFC)',
  }
  const lines: string[] = [`Tipo: ${KIND_LABELS[kind] ?? (kind || 'desconhecido')}`]
  if (kind === 'hollow_cylinder') {
    lines.push(`Dimensões: ⌀ interno ${d.insideDiameterMm}mm × altura ${d.heightMm}mm`)
  } else if (kind === 'flat_plate') {
    lines.push(`Dimensões: ${d.widthMm}×${d.heightMm}×${d.thicknessMm}mm`)
  } else if (kind === 'disc') {
    lines.push(`Dimensões: ⌀${d.diameterMm}mm × ${d.thicknessMm}mm`)
  } else if (kind === 'box') {
    lines.push(`Dimensões: ${d.widthMm}×${d.depthMm}×${d.heightMm}mm`)
  } else if (kind === 'imported') {
    const edits = Array.isArray(d.edits) ? d.edits.length : 0
    if (edits > 0) lines.push(`Edições aplicadas: ${edits}`)
  } else if (kind === 'parametric_code') {
    lines.push(`Especificação: ${String(d.spec ?? '')}`)
  } else if (kind === 'lsf_maquette') {
    lines.push(`Escala: 1:${d.scale ?? 70}`)
    lines.push(`Espessura mínima dos membros: ${d.minTMm ?? 1.9}mm`)
    if (d.fitBed !== false) lines.push('Ajuste ao leito H2D: sim')
  }
  const logo = d.logo as Record<string, unknown> | undefined
  if (logo) {
    const treatment = String(logo.treatment ?? '')
    const label =
      treatment === 'engraved' ? 'gravado'
      : treatment === 'embossed' ? 'em relevo'
      : treatment === 'through_cut' ? 'vazado'
      : treatment
    const ratio = Number(logo.sizeRatio ?? 0)
    lines.push(`Logo: ${label}${ratio > 0 ? ` (~${(ratio * 100).toFixed(0)}% da face)` : ''}`)
  }
  return lines
}

/** Badge from design kind — freeform (Meshy), imported mesh, LSF, or parametric JSCAD. */
export function badgeFor(design: unknown): 'meshy' | 'imported' | 'lsf' | 'jscad' {
  const kind = (design as { kind?: string } | undefined)?.kind
  if (kind === 'freeform') return 'meshy'
  if (kind === 'imported') return 'imported'
  if (kind === 'lsf_maquette') return 'lsf'
  return 'jscad'
}

type Msg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
  imageUrl?: string
  /** Iteration status (set by history hydration). Ready/sliced rows become
   *  navigable versions ("Ver esta versão"). */
  status?: 'generating' | 'ready' | 'failed' | 'sliced'
  /** Parsed Design JSON returned by the LLM (shown collapsible in the chat). */
  design?: unknown
  /** Sanity clamps applied to the LLM's output before geometry was built. */
  designAdjustments?: Array<{ field: string; from: number; to: number }>
  /** Edits the backend skipped or failed (e.g. logo couldn't be applied). */
  warnings?: Array<{ opIndex: number; op: string; reason: string }>
}

/** True for assistant messages that map to a viewable version: they carry an
 *  iterationId and the row produced output (ready/sliced). Live-session
 *  messages have no `status`, so only history-hydrated rows qualify. */
export function isViewableVersion(
  m: Pick<Msg, 'role' | 'iterationId' | 'status'>,
): boolean {
  return (
    m.role === 'assistant' &&
    !!m.iterationId &&
    (m.status === 'ready' || m.status === 'sliced')
  )
}

export type ChatResult =
  | { kind: 'parametric'; iterationId: string; code: string }
  | {
      kind: 'generative'
      iterationId: string
      meshUrl: string | null
      meshBase64: string | null
      /** Seed colour pickers after paint_from_image. */
      paintPalette?: { A: string; B: string }
      /** When set, ProjectWorkspace adapts validity UI (e.g. LSF multi-body). */
      designKind?: string
    }

export type PreviewBundle = { top: string; front: string; right: string; iso: string }

export default function Chat({
  projectId,
  initial,
  initialAttachedImageUrl,
  onResult,
  onMeshUploaded,
  onAttachedImageChange,
  onDiscardMesh,
  onViewIteration,
  hasImportedBase,
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
  /** Notifies parent when the attached reference image URL changes (upload/clear).
   *  Used by click-to-place logo so /api/generate gets imageUrl without a chat send. */
  onAttachedImageChange?: (url: string | null) => void
  /** Discards the pending .3mf (clears pendingMeshUrl/pendingPreviews upstream)
   *  — the exit door from imported mode (audit P1: "armadilha sem saída"). */
  onDiscardMesh?: () => void
  /** Called when the user clicks "Ver esta versão" on a ready/sliced history
   *  message. ProjectWorkspace loads that iteration's mesh into the viewer. */
  onViewIteration?: (iterationId: string) => void
  /** True when the project has an imported base (pending upload OR history).
   *  Switches the empty-chat chips to edit examples and shows the
   *  "Nova peça do zero" per-message toggle. */
  hasImportedBase?: boolean
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
  /** "Nova peça do zero" — when on, the next message ignores the imported base
   *  (server skips the history mesh fallback; nothing pending is forwarded). */
  const [startFresh, setStartFresh] = useState(false)
  /** LSF wizard: text intent or IFC path awaiting scale / run. */
  const [lsfDraft, setLsfDraft] = useState<{
    scale: number
    fitBed: boolean
    minTMm: number
    ifcUrl: string | null
    ifcName: string | null
    running: boolean
    progressLabel: string
    elapsedSec: number
  } | null>(null)
  const lsfTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function stopLsfProgress() {
    if (lsfTimerRef.current) {
      clearInterval(lsfTimerRef.current)
      lsfTimerRef.current = null
    }
  }

  function startLsfProgress() {
    stopLsfProgress()
    const t0 = Date.now()
    setLsfDraft((d) =>
      d
        ? { ...d, running: true, elapsedSec: 0, progressLabel: lsfProgressLabel(0) }
        : {
            scale: DEFAULT_LSF_SCALE,
            fitBed: true,
            minTMm: DEFAULT_LSF_MIN_T_MM,
            ifcUrl: null,
            ifcName: null,
            running: true,
            elapsedSec: 0,
            progressLabel: lsfProgressLabel(0),
          },
    )
    lsfTimerRef.current = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000)
      setLsfDraft((d) =>
        d
          ? { ...d, running: true, elapsedSec: sec, progressLabel: lsfProgressLabel(sec) }
          : d,
      )
    }, 500)
  }

  useEffect(() => () => stopLsfProgress(), [])

  function openLsfWizard(opts?: { scale?: number; fitBed?: boolean; message?: string }) {
    const scale = opts?.scale ?? DEFAULT_LSF_SCALE
    const fitBed = opts?.fitBed ?? true
    setLsfDraft({
      scale,
      fitBed,
      minTMm: DEFAULT_LSF_MIN_T_MM,
      ifcUrl: null,
      ifcName: null,
      running: false,
      progressLabel: '',
      elapsedSec: 0,
    })
    if (opts?.message) {
      setMessages((m) => [
        ...m,
        { role: 'user', text: opts.message! },
        {
          role: 'assistant',
          text:
            'Maquete LSF: escolha a escala e anexe o arquivo IFC. O worker gera o esqueleto steel frame com o perfil H2D golden.',
        },
      ])
    } else {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text:
            'Maquete LSF: escolha a escala e anexe o arquivo IFC. O worker gera o esqueleto steel frame com o perfil H2D golden.',
        },
      ])
    }
  }

  async function runLsfMaquette(opts: {
    ifcUrl: string
    ifcName?: string
    scale: number
    fitBed: boolean
    minTMm: number
  }) {
    startLsfProgress()
    setBusy(true)
    setUploadError(null)
    setMessages((m) => [
      ...m,
      {
        role: 'assistant',
        text: `Gerando maquete LSF 1:${opts.scale}${opts.fitBed ? ' (fit leito H2D)' : ''}…`,
      },
    ])
    try {
      const lsfRes = await fetch('/api/lsf-maquete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          ifcUrl: opts.ifcUrl,
          scale: opts.scale,
          minTMm: opts.minTMm,
          fitBed: opts.fitBed,
        }),
      })
      const body = (await lsfRes.json().catch(() => ({}))) as {
        mesh_url?: string
        iteration_id?: string
        error?: string
        message?: string
        design?: unknown
      }
      if (!lsfRes.ok) {
        throw new Error(body.message || body.error || `LSF ${lsfRes.status}`)
      }
      const design = body.design ?? {
        kind: 'lsf_maquette',
        ifcUrl: opts.ifcUrl,
        scale: opts.scale,
        minTMm: opts.minTMm,
        fitBed: opts.fitBed,
      }
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: 'assistant',
          text: `Maquete LSF pronta (1:${opts.scale}). Esqueleto steel frame — pode fatiar no H2D.`,
          design,
          iterationId: body.iteration_id,
          strategy: 'generative',
          status: 'ready',
        },
      ])
      if (body.mesh_url) {
        onMeshUploaded?.(body.mesh_url)
        onResult({
          kind: 'generative',
          iterationId: body.iteration_id ?? '',
          meshUrl: body.mesh_url,
          meshBase64: null,
          designKind: 'lsf_maquette',
        })
      }
      setLsfDraft(null)
    } catch (err) {
      console.error('[Chat] LSF maquete failed', err)
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: 'assistant',
          text: `Falha na maquete LSF: ${(err as Error).message}`,
        },
      ])
      setUploadError('Falha ao gerar maquete LSF a partir do IFC.')
      setLsfDraft((d) =>
        d ? { ...d, running: false, progressLabel: 'Falhou — ajuste e tente de novo' } : d,
      )
    } finally {
      stopLsfProgress()
      setBusy(false)
    }
  }

  useEffect(() => {
    onAttachedImageChange?.(attachedImage?.url ?? null)
  }, [attachedImage, onAttachedImageChange])

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected
    const lower = file.name.toLowerCase()
    const isMesh = lower.endsWith('.3mf')
    const isIfc = lower.endsWith('.ifc')
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Upload ${res.status}: ${await res.text()}`)
      const { url } = (await res.json()) as { url: string; kind?: string }
      if (isIfc) {
        // IFC → LSF pipeline. If wizard is open, use its scale; else defaults.
        setMessages((m) => [...m, { role: 'user', text: `IFC: ${file.name}` }])
        const scale = lsfDraft?.scale ?? DEFAULT_LSF_SCALE
        const fitBed = lsfDraft?.fitBed ?? true
        const minTMm = lsfDraft?.minTMm ?? DEFAULT_LSF_MIN_T_MM
        setLsfDraft((d) => ({
          scale,
          fitBed,
          minTMm,
          ifcUrl: url,
          ifcName: file.name,
          running: false,
          progressLabel: d?.progressLabel ?? '',
          elapsedSec: d?.elapsedSec ?? 0,
        }))
        await runLsfMaquette({ ifcUrl: url, ifcName: file.name, scale, fitBed, minTMm })
      } else if (isMesh) {
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
    const userText = opts?.messageOverride ?? (draft.trim() || (attachedImage ? '(apenas imagem)' : ''))

    // Text intent → LSF wizard (no IFC yet). Client-side so we skip the LLM.
    if (!opts?.designOverride && !attachedImage) {
      const intent = detectLsfIntent(userText)
      if (intent.matched) {
        if (!opts?.messageOverride) setDraft('')
        openLsfWizard({
          scale: intent.scale,
          fitBed: intent.fitBed,
          message: userText,
        })
        return
      }
    }

    // Always forward the attached image URL (including carried-from-history) so
    // paint_from_image can load the reference bytes on multi-colour turns.
    const imgUrl = attachedImage?.url
    const displayImage = attachedImage?.url
    setMessages((m) => [...m, { role: 'user', text: userText, imageUrl: displayImage }])
    if (!opts?.messageOverride) setDraft('')
    // Keep carried reference image available for follow-up multi-colour paints.
    if (attachedImage && !attachedImage.carried) {
      setAttachedImage({ url: attachedImage.url, file: null, carried: true })
    }
    setBusy(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: userText,
          imageUrl: imgUrl,
          // "Nova peça do zero": don't forward the pending mesh and tell the
          // server to skip its imported-base history fallback.
          meshUrl: startFresh ? undefined : (pendingMeshUrl ?? undefined),
          previewDataUrls: startFresh ? undefined : (pendingPreviews ?? undefined),
          ignoreImportedBase: startFresh || undefined,
          designOverride: opts?.designOverride,
        }),
      })
      if (!res.ok) throw new Error(await extractApiError(res))
      const body = (await res.json()) as {
        strategy?: 'generative'
        needs_ifc?: boolean
        intent?: string
        scale?: number
        fit_bed?: boolean
        message?: string
        iteration_id?: string
        mesh_url?: string | null
        mesh_base64?: string | null
        design?: unknown
        design_adjustments?: Array<{ field: string; from: number; to: number }>
        warnings?: Array<{ opIndex: number; op: string; reason: string }>
        meta?: {
          kind?: string
          bbox_mm?: { x: number; y: number; z: number }
          paint_palette?: { A: string; B: string }
        }
      }
      if (body.needs_ifc) {
        // Server safety net if client intent detector was skipped.
        setMessages((m) => m.slice(0, -1)) // drop the user bubble we just added — wizard re-adds
        openLsfWizard({
          scale: body.scale,
          fitBed: body.fit_bed,
          message: userText,
        })
        return
      }
      const label = resultLabel(body.meta as Parameters<typeof resultLabel>[0])
      const iterationId = body.iteration_id ?? ''
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: label,
          iterationId,
          strategy: 'generative',
          design: body.design,
          designAdjustments: body.design_adjustments,
          warnings: body.warnings,
        },
      ])
      onResult({
        kind: 'generative',
        iterationId,
        meshUrl: body.mesh_url ?? null,
        meshBase64: body.mesh_base64 ?? null,
        paintPalette: body.meta?.paint_palette,
        designKind: (body.design as { kind?: string } | undefined)?.kind ?? body.meta?.kind,
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
              {examplePromptsFor(!!hasImportedBase).map((ex) => (
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
                {badgeFor(m.design) === 'meshy'
                  ? 'imagem'
                  : badgeFor(m.design) === 'imported'
                    ? 'importado'
                    : badgeFor(m.design) === 'lsf'
                      ? 'lsf'
                      : 'paramétrico'}
              </span>
            )}
            {onViewIteration && isViewableVersion(m) && (
              <button
                type="button"
                onClick={() => onViewIteration(m.iterationId!)}
                className="ml-2 align-top text-[10px] uppercase tracking-wide text-slate-400 underline decoration-dotted underline-offset-2 transition hover:text-brand-300"
                title="Mostrar esta versão no visualizador 3D"
              >
                Ver esta versão
              </button>
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
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-300">
                  {designDetails(m.design).map((line, k) => (
                    <li key={k}>{line}</li>
                  ))}
                </ul>
                {process.env.NODE_ENV === 'development' && (
                  <details className="mt-1.5">
                    <summary className="text-[10px] text-slate-500 cursor-pointer select-none">
                      JSON (dev)
                    </summary>
                    <pre className="mt-1 text-[11px] text-slate-300 whitespace-pre-wrap overflow-x-auto">
                      {JSON.stringify(m.design, null, 2)}
                    </pre>
                  </details>
                )}
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
                      send({ designOverride: parsed, messageOverride: 'Parâmetros ajustados manualmente' })
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
            {lsfDraft?.running
              ? `${lsfDraft.progressLabel} (${lsfDraft.elapsedSec}s)`
              : 'Gerando…'}
          </div>
        )}
      </div>

      {lsfDraft && !lsfDraft.running && (
        <div className="px-4 py-3 border-t border-slate-800 bg-sky-950/40 space-y-2" data-testid="lsf-wizard">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-sky-300">
              Maquete LSF
            </span>
            <button
              type="button"
              onClick={() => setLsfDraft(null)}
              className="text-[10px] text-sky-400 hover:text-red-300 min-h-11 px-2"
              aria-label="Cancelar maquete LSF"
            >
              Cancelar
            </button>
          </div>
          <p className="text-[11px] text-sky-100/90">
            Escala arquitetônica e ajuste ao leito H2D. Depois anexe o IFC.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] uppercase text-sky-400">Escala</span>
            {LSF_SCALE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setLsfDraft((d) => (d ? { ...d, scale: s } : d))}
                className={`rounded-full px-3 py-1 text-xs min-h-11 border transition ${
                  lsfDraft.scale === s
                    ? 'border-sky-400 bg-sky-900 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-600'
                }`}
              >
                1:{s}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-sky-100 cursor-pointer select-none min-h-11">
            <input
              type="checkbox"
              checked={lsfDraft.fitBed}
              onChange={(e) =>
                setLsfDraft((d) => (d ? { ...d, fitBed: e.target.checked } : d))
              }
              className="accent-sky-500"
            />
            Ajustar ao leito H2D (fit bed)
          </label>
          {lsfDraft.ifcUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-sky-200 truncate flex-1">
                IFC: {lsfDraft.ifcName ?? 'arquivo'}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runLsfMaquette({
                    ifcUrl: lsfDraft.ifcUrl!,
                    ifcName: lsfDraft.ifcName ?? undefined,
                    scale: lsfDraft.scale,
                    fitBed: lsfDraft.fitBed,
                    minTMm: lsfDraft.minTMm,
                  })
                }
                className="rounded-lg bg-sky-600 text-white text-xs px-3 py-2 min-h-11 hover:bg-sky-500 disabled:opacity-50"
              >
                Gerar maquete
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading}
              className="w-full rounded-lg border border-sky-700 bg-sky-900/50 text-sky-100 text-xs px-3 py-2 min-h-11 hover:bg-sky-900 disabled:opacity-50"
            >
              Anexar arquivo IFC…
            </button>
          )}
        </div>
      )}

      {pendingMeshUrl && (
        <div className="px-4 pb-2 pt-2 flex items-center gap-2 border-t border-slate-800 bg-violet-950/40">
          <span className="text-lg">📦</span>
          <span className="text-xs text-violet-300 flex-1 truncate">
            {pendingPreviews
              ? '.3mf carregado — previews prontos, pode enviar uma mensagem'
              : '.3mf carregado — aguardando previews do viewer…'}
          </span>
          <button
            type="button"
            onClick={() => onDiscardMesh?.()}
            className="text-violet-300 hover:text-red-400 text-xs px-2 min-h-11 whitespace-nowrap"
            aria-label="Descartar malha"
            title="Descartar a malha importada e voltar a criar do zero"
          >
            ✕ Descartar malha
          </button>
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
              ? '↻ imagem de referência — usada como logo ou base nas próximas edições'
              : '🆕 imagem anexada — vira logo na peça ou base do modelo 3D, conforme o seu pedido'}
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

      {hasImportedBase && (
        <label className="px-4 pt-2 flex items-center gap-2 text-[11px] text-slate-400 bg-slate-900 border-t border-slate-800 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={startFresh}
            onChange={(e) => setStartFresh(e.target.checked)}
            className="accent-brand-600"
          />
          Nova peça do zero — ignorar a malha importada nesta mensagem
        </label>
      )}
      <form
        className={`p-4 flex gap-2 bg-slate-900 ${hasImportedBase ? '' : 'border-t border-slate-800'}`}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".3mf,.ifc,image/png,image/jpeg,image/webp"
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
