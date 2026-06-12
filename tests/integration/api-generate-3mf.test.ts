import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { db } from '@/db'
import { users, projects } from '@/db/schema'
import { eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import sharp from 'sharp'

let testUserId: string

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

vi.mock('@/lib/prompt/describe-image', () => ({
  describeImage: vi.fn().mockResolvedValue('Mocked image description'),
}))

// A committed fixture under /public would ship to production, and a real upload
// is machine-local (gitignored). So we synthesize a clean B/W logo into /public
// at setup and remove it after — deterministic and CI-safe. The route resolves
// non-http imageUrls relative to /public via realpath, so the file must exist.
const fixtureDir = path.join(process.cwd(), 'public', '__test_fixtures__')
const fixtureName = '3mf-pin-logo.png'
const fixtureUrl = `/__test_fixtures__/${fixtureName}`

describe('/api/generate with 3MF output', () => {
  let projectId: string

  beforeAll(async () => {
    // 200×200 white canvas with a centered 100×100 black square — a
    // high-contrast shape potrace traces cleanly into a logo outline.
    const logo = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#ffffff' },
    })
      .composite([{
        input: { create: { width: 100, height: 100, channels: 3, background: '#000000' } },
        gravity: 'centre',
      }])
      .png()
      .toBuffer()
    await mkdir(fixtureDir, { recursive: true })
    await writeFile(path.join(fixtureDir, fixtureName), logo)

    const [u] = await db.insert(users).values({ email: `3mf-${Date.now()}@example.com` }).returning()
    testUserId = u.id
    const [p] = await db.insert(projects).values({ userId: u.id, title: '3MF Test' }).returning()
    projectId = p.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId))
    await rm(fixtureDir, { recursive: true, force: true })
  })

  it('generates a pin with logo, serializes as 3MF, and verifies file headers', async () => {
    const { POST } = await import('@/app/api/generate/route')

    const imgPath = fixtureUrl

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
