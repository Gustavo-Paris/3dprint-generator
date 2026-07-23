/**
 * Route-level test: POST /api/flexify with a persistMesh that THROWS.
 *
 * Audit P1: persistMesh + the finalize updates ran OUTSIDE any try/catch — a
 * blob-store outage after a successful flexify left the iteration stuck in
 * 'generating' and returned an unhandled 500. The route must mark the row
 * failed and answer a structured apiError instead.
 *
 * All external dependencies (DB, auth, flexify pipeline, blob store) are mocked.
 */
import { describe, it, expect, vi } from 'vitest'

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'test-user-id' } })),
}))

// ── Flexify pipeline mock (succeeds — the failure under test is persistence) ──
vi.mock('@/lib/flexify', () => ({
  flexify: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    report: { componentCount: 3, jointCount: 2, totalTriangles: 10 },
  })),
}))

// ── Blob store mock: persistMesh throws ──────────────────────────────────────
vi.mock('@/lib/storage/persist', () => ({
  persistMesh: vi.fn(async () => {
    throw new Error('blob store unavailable')
  }),
}))

// ── DB mock ──────────────────────────────────────────────────────────────────
const mockProject = { id: '550e8400-e29b-41d4-a716-446655440000', userId: 'test-user-id', title: 't' }
const mockIteration = { id: 'iter-flexi-1', projectId: mockProject.id }
const MESH_URL = 'https://store1.public.blob.vercel-storage.com/test-user-id/x/src.3mf'

const makeSelectChain = (result: unknown[]) => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(result),
      orderBy: vi.fn().mockResolvedValue(result),
    }),
    orderBy: vi.fn().mockResolvedValue(result),
  }),
})

let selectCallCount = 0
const setCalls: Array<Record<string, unknown>> = []
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount++
      if (selectCallCount === 1) return makeSelectChain([mockProject])
      // History: one ready row so the route resolves a source mesh.
      return makeSelectChain([
        { id: 'iter-src', status: 'ready', meshBlobUrl: MESH_URL },
      ])
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [mockIteration]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        setCalls.push(v)
        return { where: vi.fn(async () => []) }
      }),
    })),
  },
}))

// ── Fetch mock: serve fake mesh bytes for the source URL ─────────────────────
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  headers: { get: () => null },
  body: null,
  arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
})))

describe('POST /api/flexify — persist/finalize tail guard', () => {
  it('marks the iteration failed and returns 500 persist_failed when persistMesh throws', async () => {
    selectCallCount = 0
    setCalls.length = 0

    const { POST } = await import('@/app/api/flexify/route')
    const res = await POST(
      new Request('http://localhost/api/flexify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: mockProject.id }),
      }),
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('persist_failed')
    expect(body.iteration_id).toBe(mockIteration.id)

    // The row must NOT be left 'generating': a failed update was issued.
    const failedSet = setCalls.find((s) => s.status === 'failed')
    expect(failedSet).toBeDefined()
    expect(String(failedSet!.error)).toContain('persist failed')
    // And no update ever flipped it to 'ready'.
    expect(setCalls.some((s) => s.status === 'ready')).toBe(false)
  })
})
