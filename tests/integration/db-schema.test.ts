import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq } from 'drizzle-orm'

describe('db schema', () => {
  let userId: string
  let projectId: string

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ email: `test-${Date.now()}@example.com` }).returning()
    userId = u.id
    const [p] = await db.insert(projects).values({ userId, title: 'Test project' }).returning()
    projectId = p.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId))
  })

  it('inserts and reads an iteration', async () => {
    const [it] = await db
      .insert(iterations)
      .values({
        projectId,
        userMessage: 'make a 40mm cube',
        jscadCode: '// stub',
        status: 'ready',
      })
      .returning()
    expect(it.id).toBeDefined()
    const found = await db.query.iterations.findFirst({ where: eq(iterations.id, it.id) })
    expect(found?.userMessage).toBe('make a 40mm cube')
  })

  it('cascades delete from user → project → iterations', async () => {
    const [u] = await db.insert(users).values({ email: `cascade-${Date.now()}@example.com` }).returning()
    const [p] = await db.insert(projects).values({ userId: u.id, title: 'X' }).returning()
    await db.insert(iterations).values({ projectId: p.id, userMessage: 'x', status: 'ready' })
    await db.delete(users).where(eq(users.id, u.id))
    const survivors = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(survivors).toHaveLength(0)
  })
})
