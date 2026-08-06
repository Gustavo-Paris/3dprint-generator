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
 *   - Failure → JSON `{ error: { code, message } }` envelope (extractApiError).
 */

import { extractApiError } from '@/lib/http/client-error'

export type FlexifyResult = {
  iterationId: string
  meshUrl: string | null
  meshBase64: string | null
  /** Number of articulated bodies when the server reports it. */
  bodyCount?: number
  jointCount?: number
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
  if (!res.ok) throw new Error(await extractApiError(res))

  const body = (await res.json()) as {
    iteration_id: string
    mesh_url: string | null
    mesh_base64: string | null
    report?: { bodyCount?: number; jointCount?: number; componentCount?: number }
  }
  const bodyCount =
    body.report?.bodyCount ?? body.report?.componentCount
  return {
    iterationId: body.iteration_id,
    meshUrl: body.mesh_url ?? null,
    meshBase64: body.mesh_base64 ?? null,
    bodyCount: typeof bodyCount === 'number' ? bodyCount : undefined,
    jointCount:
      typeof body.report?.jointCount === 'number' ? body.report.jointCount : undefined,
  }
}
