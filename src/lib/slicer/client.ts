import { env } from '@/env'

export type SliceResult = {
  bytes: Uint8Array
  meta: {
    print_time_min: number | null
    filament_g: number | null
  }
}

export type SlicerHealth = {
  ok: boolean
  orca?: string
  profilesDir?: string
  error?: string
}

export type SlicerErrorKind = 'offline' | 'timeout' | 'slicer'

/** Classified slicer failure so callers (route → UI) can react per kind. */
export class SlicerError extends Error {
  readonly kind: SlicerErrorKind
  readonly status?: number
  constructor(kind: SlicerErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'SlicerError'
    this.kind = kind
    this.status = status
  }
}

type ClientOpts = { timeoutMs?: number; fetchImpl?: typeof fetch }

function classifyNetworkError(e: unknown): SlicerErrorKind {
  // Our own AbortController firing on timeout surfaces as an AbortError; a
  // connection failure (ECONNREFUSED, DNS, reset) surfaces as a TypeError.
  return (e as Error)?.name === 'AbortError' ? 'timeout' : 'offline'
}

/**
 * Probe `GET ${SLICER_URL}/health`. NEVER throws — returns a classified result
 * so callers can render slicer status without try/catch.
 */
export async function checkSlicerHealth(opts: ClientOpts = {}): Promise<SlicerHealth> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 5000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // Always probe live — a health result must never be served from any fetch
    // cache (explicit no-store is belt-and-suspenders over Next's default).
    const res = await fetchImpl(`${env.SLICER_URL}/health`, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return { ok: false, error: `bad status ${res.status}` }
    const body = (await res.json()) as { ok?: boolean; orca?: string; profiles_dir?: string }
    if (!body.ok) return { ok: false, error: 'slicer reported not ok' }
    return { ok: true, orca: body.orca, profilesDir: body.profiles_dir }
  } catch (e) {
    const kind = classifyNetworkError(e)
    return { ok: false, error: kind === 'timeout' ? 'timeout' : `offline: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Slice an STL via `POST ${SLICER_URL}/slice`. Aborts after `timeoutMs` (default
 * 120s, under the route's 180s maxDuration) and throws a classified SlicerError
 * on failure. No retry — slicing is expensive and effectively non-idempotent.
 */
export async function sliceStl(stl: Uint8Array, opts: ClientOpts = {}): Promise<SliceResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  // Heavy imported meshes (700k+ triangles) routinely take 1-2 min to slice on
  // the remote, plus tens-of-MB upload — 120s aborted them mid-slice (503).
  const timeoutMs = opts.timeoutMs ?? 280_000
  const stl_base64 = Buffer.from(stl).toString('base64')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${env.SLICER_URL}/slice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stl_base64 }),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new SlicerError('slicer', `Slicer ${res.status}: ${errorBody.slice(0, 1000)}`, res.status)
    }

    const json = (await res.json()) as { bytes_base64: string; meta: SliceResult['meta'] }
    return {
      bytes: Buffer.from(json.bytes_base64, 'base64'),
      meta: json.meta,
    }
  } catch (e) {
    if (e instanceof SlicerError) throw e
    // Classify ANY non-SlicerError thrown here — including an abort during the
    // BODY read (res.text/res.json), which is the slow/hung-3MF case the timeout
    // exists for. The timer spans the body read, so a stall there aborts mid-parse;
    // without this catch that AbortError escapes raw and the route mis-maps it to
    // 502 instead of the intended 503.
    const kind = classifyNetworkError(e)
    throw new SlicerError(
      kind,
      kind === 'timeout'
        ? `Slicer timed out after ${timeoutMs}ms`
        : `Slicer request failed: ${(e as Error).message}`,
    )
  } finally {
    clearTimeout(timer)
  }
}
