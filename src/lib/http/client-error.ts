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

/**
 * Sanitize a stored iteration.error (or any thrown message) before showing it
 * in chat. Server rows used to hold raw `err.message` (SQL, stacks, path dumps);
 * new writes use short PT-BR, but history reload still needs a belt.
 */
const TECHNICAL_RE =
  /\b(select|insert|update|delete|from\s+"|relation |constraint |violates |ECONN|ENOENT|at\s+\S+\s+\(|\/Users\/|\/home\/|node_modules|SyntaxError|TypeError)\b/i

export function userSafeErrorMessage(
  raw: string | null | undefined,
  fallback = 'Algo deu errado ao gerar. Tente de novo.',
): string {
  if (!raw) return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  // Already short and clean — keep (cap length).
  if (trimmed.length <= 160 && !TECHNICAL_RE.test(trimmed) && !trimmed.includes('\n')) {
    // Strip accidental "Error: " prefix from Error.toString()
    return trimmed.replace(/^Error:\s*/i, '')
  }
  return fallback
}
