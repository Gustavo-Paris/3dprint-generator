import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq } from 'drizzle-orm'

let testUserId: string

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

vi.mock('@/lib/meshy/client', () => ({
  generateMesh: vi.fn().mockResolvedValue({
    ok: true,
    // 1 dummy triangle (84 header + 50 bytes per tri)
    stl: (() => {
      const buf = new ArrayBuffer(84 + 50)
      const dv = new DataView(buf)
      dv.setUint32(80, 1, true)
      const base = 84
      // normal (0,0,1) + tri (0,0,0)(1,0,0)(0,1,0)
      dv.setFloat32(base + 8, 1, true)
      dv.setFloat32(base + 12, 0, true); dv.setFloat32(base + 16, 0, true); dv.setFloat32(base + 20, 0, true)
      dv.setFloat32(base + 24, 1, true); dv.setFloat32(base + 28, 0, true); dv.setFloat32(base + 32, 0, true)
      dv.setFloat32(base + 36, 0, true); dv.setFloat32(base + 40, 1, true); dv.setFloat32(base + 44, 0, true)
      return new Uint8Array(buf)
    })(),
    meta: { task_id: 'mock-task', took_ms: 1234 },
  }),
  generateMeshFromImage: vi.fn(),
}))

describe('/api/generate (single-path Meshy text-to-3D)', () => {
  let projectId: string

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ email: `gen-${Date.now()}@example.com` }).returning()
    testUserId = u.id
    const [p] = await db.insert(projects).values({ userId: u.id, title: 't' }).returning()
    projectId = p.id
    process.env.MESHY_API_KEY = 'test-key'
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId))
  })

  it('text-only message: synthesizer skipped (no image), raw message → Meshy → mesh persisted', async () => {
    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ projectId, message: 'a 40mm cube' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.strategy).toBe('generative')
    expect(body.iteration_id).toBeDefined()
    expect(body.mesh_url).toBeTruthy()
    expect(body.meta.source).toBe('text')
    expect(body.meta.synthesized_prompt).toBe('a 40mm cube') // no image → no synth, raw passthrough

    const rows = await db.select().from(iterations).where(eq(iterations.projectId, projectId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ready')
    expect(rows[0].meshBlobUrl).toBeTruthy()
  })
})
