/**
 * Route-level test: POST /api/generate on the freeform (Meshy) path when the
 * Meshy client THROWS (network/transport failure — DNS, reset, timeout).
 *
 * Audit P1: only Meshy HTTP errors ({ ok: false }) were handled; a thrown
 * exception escaped the route and left the iteration row stuck 'generating'.
 * The route must mark the row failed and answer 502 meshy_failed.
 *
 * All external dependencies (DB, auth, LLM parser, settings, Meshy) are mocked.
 */
import { describe, it, expect, vi } from 'vitest'

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'test-user-id' } })),
}))

// ── LLM parser mock: route to the freeform/Meshy branch ──────────────────────
vi.mock('@/lib/design/parse', () => ({
  parseDesign: vi.fn(async () => ({
    kind: 'freeform',
    prompt: 'a small dragon figurine',
    artStyle: 'realistic',
  })),
}))

// ── Settings mock: Meshy key present so the freeform branch proceeds ─────────
vi.mock('@/lib/settings/store', () => ({
  resolveConfig: vi.fn(async () => ({ meshyApiKey: 'test-key' })),
  DEFAULT_FILAMENT_COLOR_BODY: '#3B82F6',
  DEFAULT_FILAMENT_COLOR_ACCENT: '#22C55E',
}))

// ── Meshy client mock: both entry points THROW (transport failure) ───────────
vi.mock('@/lib/meshy/client', () => ({
  generateMesh: vi.fn(async () => {
    throw new Error('fetch failed: ECONNRESET')
  }),
  generateMeshFromImage: vi.fn(async () => {
    throw new Error('fetch failed: ECONNRESET')
  }),
}))

// ── DB mock ──────────────────────────────────────────────────────────────────
const mockProject = { id: '550e8400-e29b-41d4-a716-446655440000', userId: 'test-user-id', title: 't' }
const mockIteration = { id: 'iter-freeform-1', projectId: mockProject.id }

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
      return makeSelectChain([]) // empty history
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [mockIteration]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        setCalls.push(v)
        // The route both awaits `.where(...)` directly and (reaper) chains
        // `.where(...).returning()` — return a thenable exposing both.
        return {
          where: vi.fn(() =>
            Object.assign(Promise.resolve([] as unknown[]), {
              returning: vi.fn(async () => [] as unknown[]),
            }),
          ),
        }
      }),
    })),
  },
}))

describe('POST /api/generate — freeform path when Meshy throws', () => {
  it('marks the iteration failed and returns 502 meshy_failed', async () => {
    selectCallCount = 0
    setCalls.length = 0

    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: mockProject.id,
          message: 'a small dragon figurine',
        }),
      }),
    )

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error.code).toBe('meshy_failed')
    expect(body.iteration_id).toBe(mockIteration.id)

    // The row must NOT be left 'generating'. (Match on the error text so the
    // reaper's own status:'failed' update can't satisfy this assertion.)
    const failedSet = setCalls.find(
      (s) => s.status === 'failed' && String(s.error).includes('meshy failed'),
    )
    expect(failedSet).toBeDefined()
    expect(setCalls.some((s) => s.status === 'ready')).toBe(false)
  })
})
