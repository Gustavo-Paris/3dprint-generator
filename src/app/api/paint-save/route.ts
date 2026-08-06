/**
 * POST /api/paint-save — persist a client-side manual paint session as a NEW
 * iteration.
 *
 * Manual paint runs 100% in the browser (Web Worker over paintMeshRef); the
 * result lives only in client memory and is lost on reload — and Fatiar always
 * slices the SERVER-persisted mesh. This route closes that gap:
 *
 *   1. Auth + ownership of the base iteration (join with projects, like slice).
 *   2. Decode the painted bodies (base64 Float32Array triangle soup per body).
 *   3. serialize3mf(bodies) with the user's palette + full printer profile
 *      (project_settings) so the download opens print-ready in Bambu/Orca.
 *   4. persistMesh + INSERT a new 'ready' iteration cloning the base design
 *      (flexify's mesh-backed row-creation pattern).
 *
 * Response: { iteration_id, mesh_url }.
 */
import { auth } from '@/auth'
import { db } from '@/db'
import { iterations, projects } from '@/db/schema'
import { serialize3mf, type MeshBodyData } from '@/lib/3mf/serialize-3mf'
import { getPrinter, buildProjectSettings } from '@/lib/print-profile'
import {
  resolveConfig,
  DEFAULT_FILAMENT_COLOR_BODY,
  DEFAULT_FILAMENT_COLOR_ACCENT,
} from '@/lib/settings/store'
import { persistMesh } from '@/lib/storage/persist'
import { apiError } from '@/lib/http/api-error'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { createRequestLogger } from '@/lib/log'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
// Painted sculpts are heavy (700k+ tris ≈ 25MB of floats ≈ 34MB base64):
// decoding + welding + XML serialization take a while, like slicing does.
export const maxDuration = 300

// Mirror the mesh-payload ceiling the slicer service uses (express.json 100mb).
const MAX_BODY_BYTES = 100 * 1024 * 1024

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const Body = z.object({
  /** Iteration the paint session started from (ownership + design source). */
  iterationId: z.string().uuid(),
  /** Painted triangle soup split by extruder. positionsB64 is a base64-encoded
   *  Float32Array of [x,y,z]×3 per triangle (length multiple of 9 floats). */
  bodies: z
    .array(
      z.object({
        positionsB64: z.string().min(1).max(90 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
        extruder: z.enum(['A', 'B']),
        label: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(16),
  /** Filament colour per extruder as '#RRGGBB' (paint palette). */
  palette: z.object({ A: HexColor, B: HexColor }).optional(),
})

/**
 * Decode a base64 Float32Array triangle soup WITHOUT JSON-parsing numeric
 * arrays (a 700k-tri mesh is ~25MB of floats — Buffer decode only).
 *
 * Copies into a fresh aligned buffer: Node pools small Buffers, so
 * `buf.byteOffset` is not guaranteed 4-byte aligned for a Float32Array view.
 */
function decodePositions(b64: string): Float32Array | null {
  const buf = Buffer.from(b64, 'base64')
  // Whole triangles only: 3 verts × 3 coords × 4 bytes.
  if (buf.byteLength === 0 || buf.byteLength % 36 !== 0) return null
  const aligned = new Uint8Array(buf.byteLength)
  aligned.set(buf)
  return new Float32Array(aligned.buffer)
}

export async function POST(req: Request) {
  const log = createRequestLogger('paint-save')
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  // Stream-enforced ceiling: a chunked-transfer request has no Content-Length
  // (Number(null) = 0 passed the old header-only check), so the cap must count
  // actual wire bytes — readBodyCapped cancels the stream past the limit
  // instead of letting req.json() buffer an unbounded body (OOM DoS).
  const bodyBuf = await readBodyCapped(req, MAX_BODY_BYTES)
  if (bodyBuf === null) {
    return apiError(413, 'payload_too_large', 'A malha pintada excede o limite de 100MB.')
  }

  let raw: unknown
  try {
    raw = JSON.parse(bodyBuf.toString('utf8'))
  } catch {
    return apiError(400, 'invalid_body', 'Requisição inválida.')
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) return apiError(400, 'invalid_body', 'Requisição inválida.')
  const { iterationId, bodies, palette } = parsed.data

  // Ownership: the base iteration must belong to a project of this user
  // (same join as /api/slice; non-owner sees 404, never 403).
  const [row] = await db
    .select({ iteration: iterations, project: projects })
    .from(iterations)
    .innerJoin(projects, eq(iterations.projectId, projects.id))
    .where(and(eq(iterations.id, iterationId), eq(projects.userId, session.user.id)))
    .limit(1)
  if (!row) return apiError(404, 'not_found', 'Iteração não encontrada.')

  // Decode BEFORE creating any DB row so malformed payloads never strand an
  // iteration. Buffer-only decode — no JSON.parse of numeric arrays.
  const meshBodies: MeshBodyData[] = []
  for (const body of bodies) {
    const positions = decodePositions(body.positionsB64)
    if (!positions) {
      return apiError(400, 'invalid_positions', 'Malha pintada inválida (triângulos incompletos).')
    }
    meshBodies.push({ positions, extruder: body.extruder, label: body.label })
  }

  // Full print profile so the persisted 3MF opens ready-to-slice, mirroring the
  // multi-body export in /api/generate.
  const cfg = await resolveConfig()
  const printer = getPrinter(cfg.printerModel)
  const profileColors = {
    bodyHex: palette?.A ?? cfg.filamentColorBody ?? DEFAULT_FILAMENT_COLOR_BODY,
    accentHex: palette?.B ?? cfg.filamentColorAccent ?? DEFAULT_FILAMENT_COLOR_ACCENT,
  }

  let bytes: Uint8Array
  try {
    bytes = serialize3mf(meshBodies, {
      ...(palette ? { colors: { aHex: palette.A, bHex: palette.B } } : {}),
      projectSettings: buildProjectSettings(
        printer,
        { multicolor: true, standing: false },
        profileColors,
      ),
    })
  } catch (err) {
    log.error('paint serialize failed', err, { iterationId })
    return apiError(500, 'serialize_failed', 'Não foi possível montar a malha pintada.')
  }

  // Clone the base design (minus the heavy cached previews) so the new row
  // keeps its kind/params, and stamp the paint palette for later re-hydration.
  const baseReport = row.iteration.validationReport
  const design: Record<string, unknown> =
    baseReport && typeof baseReport === 'object' && !Array.isArray(baseReport)
      ? { ...(baseReport as Record<string, unknown>) }
      : {}
  delete design._previews
  const validationReport: Record<string, unknown> = {
    ...design,
    ...(palette ? { _paintPalette: palette } : {}),
  }

  // Flexify's mesh-backed row pattern: insert first (id feeds the mesh key),
  // persist, then flip to ready — a persist failure marks the row failed.
  const [iteration] = await db
    .insert(iterations)
    .values({
      projectId: row.iteration.projectId,
      userMessage: 'Pintura manual aplicada',
      status: 'generating',
      // Painted mesh is an edit of the source iteration — prefer its real kind;
      // fall back to imported when missing or legacy 'generative'.
      strategy:
        row.iteration.strategy && row.iteration.strategy !== 'generative'
          ? row.iteration.strategy
          : 'imported',
    })
    .returning()

  let meshUrl: string
  try {
    meshUrl = await persistMesh(bytes, session.user.id, row.iteration.projectId, iteration.id)
  } catch (err) {
    log.error('paint persist failed', err, { iterationId, newIterationId: iteration.id })
    await db.update(iterations)
      .set({ status: 'failed', error: 'Não foi possível salvar a malha pintada.' })
      .where(eq(iterations.id, iteration.id))
    return apiError(500, 'persist_failed', 'Não foi possível salvar a malha pintada.', {
      iteration_id: iteration.id,
    })
  }

  await db.update(iterations)
    .set({ status: 'ready', meshBlobUrl: meshUrl, validationReport })
    .where(eq(iterations.id, iteration.id))
  await db.update(projects)
    .set({ currentIterationId: iteration.id, updatedAt: new Date() })
    .where(eq(projects.id, row.iteration.projectId))

  return Response.json({ iteration_id: iteration.id, mesh_url: meshUrl })
}
