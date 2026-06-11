import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { db } from '@/db'
import { users, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'

let testUserId: string

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

vi.mock('@/lib/prompt/describe-image', () => ({
  describeImage: vi.fn().mockResolvedValue('Mocked image description'),
}))

describe('/api/generate with 3MF output', () => {
  let projectId: string

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ email: `3mf-${Date.now()}@example.com` }).returning()
    testUserId = u.id
    const [p] = await db.insert(projects).values({ userId: u.id, title: '3MF Test' }).returning()
    projectId = p.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId))
  })

  it('generates a pin with logo, serializes as 3MF, and verifies file headers', async () => {
    const { POST } = await import('@/app/api/generate/route')
    
    // Choose an image file that exists in the public uploads dir
    const imgName = '7e3ecc17-f51f-4c4c-87dc-d9fc9480901a.jpg'
    const imgPath = `/uploads/${imgName}`

    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          message: 'pin with logo',
          imageUrl: imgPath,
          designOverride: {
            kind: 'pin',
            logo: {
              extruder: 'B',
              position: 'bottom_face',
              sizeRatio: 0.7,
              treatment: 'engraved',
              depthMm: 0.8
            },
            extruder: 'A',
            diameterMm: 25,
            pinHeightMm: 8,
            thicknessMm: 2,
            pinDiameterMm: 4.5
          }
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    console.log("3MF generation response:", body)
    
    expect(body.strategy).toBe('generative')
    expect(body.mesh_url).toContain('.3mf')
    expect(body.mesh_url).not.toContain('.stl')

    // Read the local file to check headers
    const filePath = path.join(process.cwd(), 'public', body.mesh_url)
    expect(fs.existsSync(filePath)).toBe(true)

    const bytes = fs.readFileSync(filePath)
    // Check ZIP header: PK (0x50, 0x4b)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })
})
