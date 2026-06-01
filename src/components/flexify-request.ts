/**
 * Browser-side client for `POST /api/flexify`.
 *
 * Kept separate from `@/lib/flexify` (the server mesh pipeline, which pulls in
 * Node-only deps) so importing it from a Client Component never drags the heavy
 * geometry code into the browser bundle.
 *
 * Contract (see src/app/api/flexify/route.ts):
 *   - We send ONLY `{ projectId }`. We deliberately never send a `meshUrl`: the
 *     route resolves the project's latest ready mesh itself, and its allowlist
 *     rejects any URL the server didn't issue (SSRF / path-traversal defense).
 *   - Success → JSON `{ iteration_id, mesh_url, mesh_base64, ... }`.
 *   - Failure → JSON `{ error }` on a 500 (pipeline error), or a plain-text body
 *     on 4xx (auth / validation). extractError handles both shapes.
 */

export type FlexifyResult = {
  iterationId: string
  meshUrl: string | null
  meshBase64: string | null
}

async function extractError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const json = JSON.parse(text) as { error?: unknown }
    if (typeof json.error === 'string' && json.error) return json.error
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return text || `Flexify request failed (${res.status})`
}

export async function requestFlexify(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FlexifyResult> {
  const res = await fetchImpl('/api/flexify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  if (!res.ok) throw new Error(await extractError(res))

  const body = (await res.json()) as {
    iteration_id: string
    mesh_url: string | null
    mesh_base64: string | null
  }
  return {
    iterationId: body.iteration_id,
    meshUrl: body.mesh_url ?? null,
    meshBase64: body.mesh_base64 ?? null,
  }
}
