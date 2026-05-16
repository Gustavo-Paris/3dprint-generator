import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq } from 'drizzle-orm'

let testUserId: string

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn().mockImplementation(({ onFinish }: any) => {
      const fixture = `const main = () => jscad.primitives.cuboid({ size: [40, 40, 40] })\nmodule.exports = { main }`
      setTimeout(() => onFinish({ text: fixture }), 0)
      return {
        toTextStreamResponse: () =>
          new Response(fixture, { headers: { 'content-type': 'text/plain' } }),
      }
    }),
  }
})

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

describe('/api/generate', () => {
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

  it('persists an iteration and streams JSCAD code back', async () => {
    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ projectId, message: 'make a 40mm cube' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('cuboid')
    await new Promise((r) => setTimeout(r, 50))
    const rows = await db.select().from(iterations).where(eq(iterations.projectId, projectId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ready')
    expect(rows[0].jscadCode).toContain('cuboid')
  })
})
