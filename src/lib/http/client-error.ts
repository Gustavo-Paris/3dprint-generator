/**
 * Client-side counterpart of `apiError` (src/lib/http/api-error.ts).
 *
 * Every API route replies with the envelope `{ error: { code, message } }`
 * where `message` is already user-safe PT-BR. UI components must show THAT
 * message — never the raw JSON body or an HTTP status dump ("API 500: {...}").
 *
 * `extractApiError` parses the envelope out of a `Response` (async) or an
 * already-read body string (sync) and falls back to a generic PT-BR message
 * when the body is not the expected envelope (HTML error page, empty body,
 * plain text from a proxy, …).
 */

function generic(status?: number): string {
  return status != null
    ? `Algo deu errado (HTTP ${status}). Tente novamente.`
    : 'Algo deu errado. Tente novamente.'
}

function fromText(text: string, status?: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } } | null
    const msg = parsed?.error?.message
    if (typeof msg === 'string' && msg.trim().length > 0) return msg
  } catch {
    // Not JSON — fall through to the generic message.
  }
  return generic(status)
}

export function extractApiError(res: Response): Promise<string>
export function extractApiError(res: string, status?: number): string
export function extractApiError(
  res: Response | string,
  status?: number,
): Promise<string> | string {
  if (typeof res === 'string') return fromText(res, status)
  return res.text().then(
    (text) => fromText(text, res.status),
    () => generic(res.status),
  )
}
