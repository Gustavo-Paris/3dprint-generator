import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq } from 'drizzle-orm'

let testUserId: string

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

// Mock the LLM parser so the route runs without real API credentials.
// Return a small flat_plate — the simplest primitive to build.
vi.mock('@/lib/design/parse', () => ({
  parseDesign: vi.fn().mockResolvedValue({
    kind: 'flat_plate',
    widthMm: 40,
    heightMm: 40,
    thicknessMm: 4,
    cornerRadiusMm: 2,
  }),
}))

describe('/api/generate (Design → parametric generator)', () => {
  let projectId: string

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ email: `gen-${Date.now()}@example.com` }).returning()
    testUserId = u.id
    const [p] = await db.insert(projects).values({ userId: u.id, title: 't' }).returning()
    projectId = p.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId))
  })

  it('text-only message: LLM parser → flat_plate → mesh persisted', async () => {
    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ projectId, message: 'a 40mm flat square' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.strategy).toBe('generative')
    expect(body.iteration_id).toBeDefined()
    expect(body.mesh_url).toBeTruthy()
    expect(body.meta.kind).toBe('flat_plate')

    const rows = await db.select().from(iterations).where(eq(iterations.projectId, projectId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ready')
    expect(rows[0].meshBlobUrl).toBeTruthy()
  })

  it('keeps a custom project title untouched (no auto-title)', async () => {
    const [after] = await db.select().from(projects).where(eq(projects.id, projectId))
    expect(after.title).toBe('t')
  })

  it('previousDesign continuity: quick modifier iterates on a design from a SLICED row', async () => {
    // Slicing flips 'ready' → 'sliced' while keeping validationReport. The
    // iterate path must still find that design (audit: "Fatiar quebra a
    // continuidade").
    const [p] = await db
      .insert(projects)
      .values({ userId: testUserId, title: 'sliced-continuity' })
      .returning()
    await db.insert(iterations).values({
      projectId: p.id,
      userMessage: 'a 40mm flat square',
      status: 'sliced',
      strategy: 'generative',
      validationReport: {
        kind: 'flat_plate', widthMm: 40, heightMm: 40, thicknessMm: 4, cornerRadiusMm: 2,
      },
    })

    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ projectId: p.id, message: 'mais alta' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // 40 × 1.2 = 48 proves the deterministic quick modifier saw the sliced
    // row's design. If previousDesign were null (old behavior), the mocked
    // LLM would have answered and heightMm would still be 40.
    expect(body.design.kind).toBe('flat_plate')
    expect(body.design.heightMm).toBe(48)
  })

  it('auto-titles a default-titled project after the first ready iteration', async () => {
    const [p] = await db
      .insert(projects)
      .values({ userId: testUserId, title: 'Projeto sem título' })
      .returning()

    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ projectId: p.id, message: 'porta-canetas hexagonal azul' }),
      }),
    )
    expect(res.status).toBe(200)

    const [after] = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(after.title).toBe('porta-canetas hexagonal azul')
  })
})
