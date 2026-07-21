/**
 * Integration test: POST /api/generate with an imported .3mf mesh.
 *
 * All external dependencies (DB, auth, AI, fetch) are mocked.
 * The 3MF fixture (cube-30mm.3mf) is served via the fetch mock so the
 * mesh-loading pipeline runs with real geometry.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'test-user-id' } })),
}))

// ── DB mock ──────────────────────────────────────────────────────────────────
// The route issues:
//   1. db.select().from(projects).where(...).limit(1)   → [project]
//   2. db.select().from(iterations).where(...).orderBy(...)  → [] (no history)
//   3. db.insert(iterations).values(...).returning()    → [iteration]
//   4. db.update(iterations).set(...).where(...)
//   5. db.update(projects).set(...).where(...)
//
// We distinguish the two select calls by tracking call order on the `from` spy.
const mockProject = { id: '550e8400-e29b-41d4-a716-446655440000', userId: 'test-user-id', title: 'test' }
const mockIteration = { id: 'iter-imported-1', projectId: mockProject.id }

// A mini chainable mock factory.
const makeSelectChain = (result: unknown[]) => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(result),
      orderBy: vi.fn().mockResolvedValue(result),
    }),
    orderBy: vi.fn().mockResolvedValue(result),
  }),
})

// `select` is called twice. First call → project (non-empty), second call → iterations (empty).
let selectCallCount = 0
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount++
      if (selectCallCount === 1) {
        // Projects query
        return makeSelectChain([mockProject])
      }
      // Iterations history query
      return makeSelectChain([])
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [mockIteration]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        // The route both awaits `.where(...)` directly (status updates) and
        // chains `.where(...).returning()` (reapStuckIterations). Return a
        // thenable that also exposes `.returning()` to satisfy both shapes.
        where: vi.fn(() =>
          Object.assign(Promise.resolve([] as unknown[]), {
            returning: vi.fn(async () => [] as unknown[]),
          }),
        ),
      })),
    })),
  },
}))

// ── AI mock ──────────────────────────────────────────────────────────────────
// Return a valid imported Design: scale factor 0.5 on the 30mm cube → 15mm cube.
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: JSON.stringify({
      kind: 'imported',
      baseMeshUrl: 'http://mock/cube.3mf',
      edits: [{ op: 'scale', factor: 0.5 }],
    }),
  })),
}))

// ── LLM model mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/llm/model', () => ({
  getModel: vi.fn(() => 'mock-model'),
  getClassifierModel: vi.fn(() => 'mock-classifier'),
}))

// ── Fetch mock: serve the cube fixture for .3mf URL ──────────────────────────
// Use a lazy approach so we can read the file asynchronously inside the mock.
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (typeof url === 'string' && url.includes('cube.3mf')) {
    const bytes = await readFile(join(__dirname, '../fixtures/cube-30mm.3mf'))
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
}))

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/generate (imported .3mf flow)', () => {
  it('returns 200, strategy=generative, design.kind=imported, bbox ~15mm (half of 30mm cube)', async () => {
    // Reset call counter before each test so mocks are deterministic
    selectCallCount = 0

    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          message: 'scale it to half size',
          meshUrl: 'https://store1.public.blob.vercel-storage.com/test-user-id/uploads/cube.3mf',
          previewDataUrls: {
            top:   'data:image/png;base64,iVBOR',
            front: 'data:image/png;base64,iVBOR',
            right: 'data:image/png;base64,iVBOR',
            iso:   'data:image/png;base64,iVBOR',
          },
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.strategy).toBe('generative')
    expect(body.design.kind).toBe('imported')
    expect(body.meta.bbox_mm.x).toBeCloseTo(15, 0)
    expect(body.iteration_id).toBe(mockIteration.id)
  })

  // Previews are optional by design: the route falls back to a 1×1 stub bundle
  // (paint ops ignore previews; the LLM path still gets real ones when sent).
  it('succeeds with stub previews when meshUrl provided but no previews', async () => {
    selectCallCount = 0

    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          message: 'scale it',
          meshUrl: 'https://store1.public.blob.vercel-storage.com/test-user-id/uploads/cube.3mf',
          // No previewDataUrls — route substitutes the stub bundle.
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.design.kind).toBe('imported')
  })
})
