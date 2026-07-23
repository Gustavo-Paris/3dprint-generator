/**
 * Unit tests: POST /api/paint-save — persist a client-side paint session as a
 * new iteration.
 *
 * External deps (auth, db, blob persistence, settings) are mocked; the 3MF
 * serializer and print-profile builder run for real so the happy path proves
 * actual painted bytes reach persistMesh. Validates the auth gate, the
 * ownership-scoped lookup (non-owner → 404, not 403), body validation, and the
 * ready-iteration clone (design minus _previews, palette stamped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UUID = 'ec211884-b908-4057-b8d5-dba3fd9c28e2'

// ── Auth mock ────────────────────────────────────────────────────────────────
const authMock = vi.fn()
vi.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }))

// ── DB mock ──────────────────────────────────────────────────────────────────
// Route issues:
//   db.select().from(iterations).innerJoin(projects).where(...).limit(1)
//   db.insert(iterations).values(...).returning()
//   db.update(table).set(...).where(...)
const limitMock = vi.fn(async () => [] as unknown[])
const insertValuesMock = vi.fn()
const updateSetMock = vi.fn()
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: limitMock })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        insertValuesMock(v)
        return { returning: async () => [{ id: 'new-iter-1', ...v }] }
      },
    })),
    update: vi.fn(() => ({
      set: (s: Record<string, unknown>) => {
        updateSetMock(s)
        return { where: async () => undefined }
      },
    })),
  },
}))

// ── Persistence mock ─────────────────────────────────────────────────────────
const persistMeshMock = vi.fn(async (..._args: unknown[]) => '/meshes/new-iter-1.3mf')
vi.mock('@/lib/storage/persist', () => ({
  persistMesh: (...args: unknown[]) => persistMeshMock(...args),
}))

// ── Settings mock (printer + default filament colours) ───────────────────────
vi.mock('@/lib/settings/store', () => ({
  resolveConfig: vi.fn(async () => ({
    printerModel: null,
    filamentColorBody: null,
    filamentColorAccent: null,
  })),
  DEFAULT_FILAMENT_COLOR_BODY: '#3B82F6',
  DEFAULT_FILAMENT_COLOR_ACCENT: '#22C55E',
}))

async function getRoute() {
  return import('@/app/api/paint-save/route')
}

/** base64 of a Float32Array triangle soup (len must be a multiple of 9). */
function trisB64(floats: number[]): string {
  return Buffer.from(new Float32Array(floats).buffer).toString('base64')
}

const ONE_TRI = trisB64([0, 0, 0, 1, 0, 0, 0, 1, 0])

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/paint-save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  iterationId: UUID,
  bodies: [
    { positionsB64: ONE_TRI, extruder: 'A', label: 'body' },
    { positionsB64: ONE_TRI, extruder: 'B', label: 'paint' },
  ],
  palette: { A: '#112233', B: '#AABBCC' },
}

const ownedRow = {
  iteration: {
    id: UUID,
    projectId: 'proj-1',
    status: 'ready',
    meshBlobUrl: '/meshes/base.3mf',
    validationReport: {
      kind: 'imported',
      _previews: { top: 'data:...' },
      _faces: [{ id: 'f1' }],
    },
  },
  project: { id: 'proj-1', userId: 'user-1' },
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: 'user-1' } })
  limitMock.mockReset().mockResolvedValue([])
  insertValuesMock.mockReset()
  updateSetMock.mockReset()
  persistMeshMock.mockReset().mockResolvedValue('/meshes/new-iter-1.3mf')
})

describe('POST /api/paint-save', () => {
  it('returns 401 when unauthenticated, before touching the db', async () => {
    authMock.mockResolvedValue(null)
    const { POST } = await getRoute()
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(401)
    expect(limitMock).not.toHaveBeenCalled()
    expect(persistMeshMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid body (bad extruder, missing bodies, bad palette)', async () => {
    const { POST } = await getRoute()
    for (const bad of [
      {},
      { iterationId: 'not-a-uuid', bodies: validBody.bodies },
      { iterationId: UUID, bodies: [] },
      { iterationId: UUID, bodies: [{ positionsB64: ONE_TRI, extruder: 'C', label: 'x' }] },
      { iterationId: UUID, bodies: validBody.bodies, palette: { A: 'red', B: '#AABBCC' } },
    ]) {
      const res = await POST(makeReq(bad))
      expect(res.status, JSON.stringify(bad)).toBe(400)
      const json = await res.json()
      expect(json.error.code).toBe('invalid_body')
    }
    expect(persistMeshMock).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_positions when floats are not whole triangles', async () => {
    limitMock.mockResolvedValue([ownedRow])
    const { POST } = await getRoute()
    const res = await POST(
      makeReq({
        iterationId: UUID,
        // 6 floats = 2 vertices — not a whole triangle (multiple of 9).
        bodies: [{ positionsB64: trisB64([0, 0, 0, 1, 1, 1]), extruder: 'A', label: 'x' }],
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('invalid_positions')
    expect(persistMeshMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the base iteration belongs to another user', async () => {
    limitMock.mockResolvedValue([]) // ownership join found nothing
    const { POST } = await getRoute()
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('not_found')
    expect(insertValuesMock).not.toHaveBeenCalled()
    expect(persistMeshMock).not.toHaveBeenCalled()
  })

  it('happy path: persists a painted 3MF and creates a ready iteration clone', async () => {
    limitMock.mockResolvedValue([ownedRow])
    const { POST } = await getRoute()
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ iteration_id: 'new-iter-1', mesh_url: '/meshes/new-iter-1.3mf' })

    // New row created against the BASE iteration's project (flexify pattern).
    expect(insertValuesMock).toHaveBeenCalledWith({
      projectId: 'proj-1',
      userMessage: 'Pintura manual aplicada',
      status: 'generating',
      strategy: 'generative',
    })

    // Real serialize3mf output reached persistMesh: a 3MF is a zip (PK magic).
    expect(persistMeshMock).toHaveBeenCalledTimes(1)
    const [bytes, userId, projectId, newIterId] = persistMeshMock.mock.calls[0] as unknown as [
      Uint8Array, string, string, string,
    ]
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(userId).toBe('user-1')
    expect(projectId).toBe('proj-1')
    expect(newIterId).toBe('new-iter-1')

    // Finalize update: ready + mesh url + design clone without _previews,
    // keeping kind/_faces, and stamping the paint palette.
    const readySet = updateSetMock.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((s) => s.status === 'ready')
    expect(readySet).toBeDefined()
    expect(readySet!.meshBlobUrl).toBe('/meshes/new-iter-1.3mf')
    expect(readySet!.validationReport).toEqual({
      kind: 'imported',
      _faces: [{ id: 'f1' }],
      _paintPalette: { A: '#112233', B: '#AABBCC' },
    })

    // Project pointer moved to the new iteration.
    const projectSet = updateSetMock.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((s) => s.currentIterationId !== undefined)
    expect(projectSet?.currentIterationId).toBe('new-iter-1')
  })

  it('accepts a chunked request (no Content-Length) — capped streaming replaces req.json()', async () => {
    limitMock.mockResolvedValue([ownedRow])
    const { POST } = await getRoute()
    const payload = new TextEncoder().encode(JSON.stringify(validBody))
    const req = new Request('http://localhost/api/paint-save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(payload)
          c.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    expect(req.headers.get('content-length')).toBeNull() // precondition: chunked shape
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(persistMeshMock).toHaveBeenCalledTimes(1)
  })

  it('returns 413 when content-length exceeds the 100MB cap', async () => {
    const { POST } = await getRoute()
    const req = new Request('http://localhost/api/paint-save', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(101 * 1024 * 1024),
      },
      body: JSON.stringify(validBody),
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(persistMeshMock).not.toHaveBeenCalled()
  })

  it('marks the new row failed and returns 500 when persistence fails', async () => {
    limitMock.mockResolvedValue([ownedRow])
    persistMeshMock.mockRejectedValue(new Error('blob down'))
    const { POST } = await getRoute()
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(500)
    const failedSet = updateSetMock.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((s) => s.status === 'failed')
    expect(failedSet).toBeDefined()
    expect(String(failedSet!.error)).toContain('blob down')
  })
})
