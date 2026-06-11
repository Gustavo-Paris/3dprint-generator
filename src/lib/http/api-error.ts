/**
 * Uniform JSON error envelope for every API route.
 *
 * Clients read `error.code` (stable, machine-readable) and may show
 * `error.message` (generic, user-safe PT-BR — NEVER an LLM/internal string or
 * a raw exception message). Internal detail goes to logs + the DB iteration
 * row, never the wire.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: { code, message }, ...extra }, { status })
}
