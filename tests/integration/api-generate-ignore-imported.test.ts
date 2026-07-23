/**
 * Integration test: POST /api/generate with `ignoreImportedBase: true`
 * ("Nova peça do zero" — the exit door from imported mode, audit P1).
 *
 * A project whose history contains an imported base would normally fall back to
 * that base mesh for every new message. With the flag, the route must:
 *   1. NOT resolve/load the imported base mesh from history, and
 *   2. NOT feed the imported design to the LLM as previousDesign
 * so the message generates a fresh (here: parametric) design.
 *
 * Mock structure mirrors tests/integration/api-generate-imported.test.ts.
 */
import { describe, it, expect, vi } from 'vitest'

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'test-user-id' } })),
}))

// ── DB mock ──────────────────────────────────────────────────────────────────
const mockProject = { id: '550e8400-e29b-41d4-a716-446655440000', userId: 'test-user-id', title: 'test' }
const mockIteration = { id: 'iter-fresh-1', projectId: mockProject.id }

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
let mockHistory: unknown[] = []
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount++
      if (selectCallCount === 1) return makeSelectChain([mockProject])
      return makeSelectChain(mockHistory)
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [mockIteration]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() =>
          Object.assign(Promise.resolve([] as unknown[]), {
            returning: vi.fn(async () => [] as unknown[]),
          }),
        ),
      })),
    })),
  },
}))

// ── AI mock: a fresh parametric design (NOT imported) ────────────────────────
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: JSON.stringify({
      kind: 'flat_plate',
      widthMm: 80,
      heightMm: 40,
      thicknessMm: 4,
    }),
  })),
}))

vi.mock('@/lib/llm/model', () => ({
  getModel: vi.fn(() => 'mock-model'),
  getClassifierModel: vi.fn(() => 'mock-classifier'),
}))

// ── Fetch mock: FAIL any .3mf fetch — proving the base mesh is never loaded ──
const fetchSpy = vi.fn(async (..._args: unknown[]) => ({
  ok: false,
  status: 404,
  arrayBuffer: async () => new ArrayBuffer(0),
}))
vi.stubGlobal('fetch', fetchSpy)

describe('POST /api/generate (ignoreImportedBase)', () => {
  it('skips the imported-base fallback AND the imported previousDesign', async () => {
    selectCallCount = 0
    mockHistory = [
      {
        id: 'iter-imported-prev',
        projectId: mockProject.id,
        userMessage: 'import the cube',
        imageBlobUrl: null,
        imageDescription: null,
        meshBlobUrl: 'https://store1.public.blob.vercel-storage.com/test-user-id/x/prev.3mf',
        status: 'ready',
        createdAt: new Date(),
        validationReport: {
          kind: 'imported',
          baseMeshUrl: 'http://mock/cube.3mf',
          edits: [{ op: 'scale', factor: 0.25 }],
        },
      },
    ]

    const { generateText } = await import('ai')
    vi.mocked(generateText).mockClear()

    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          message: 'plaquinha de mesa 80x40',
          ignoreImportedBase: true,
          // No meshUrl — without the flag, the imported history row would win.
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.design.kind).toBe('flat_plate')

    // The base mesh was never loaded (any .3mf fetch would have 404'd → 500).
    const meshFetches = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('cube.3mf'),
    )
    expect(meshFetches).toHaveLength(0)

    // The imported design never reached the LLM as previousDesign — its
    // distinctive baseMeshUrl/factor must be absent from every prompt.
    const promptText = JSON.stringify(vi.mocked(generateText).mock.calls)
    expect(promptText).not.toContain('mock/cube.3mf')
    expect(promptText).not.toContain('0.25')
  })
})
