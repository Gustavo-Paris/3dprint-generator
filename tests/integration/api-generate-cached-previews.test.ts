/**
 * Integration test (real Postgres): post-reload LLM edits on an imported base
 * must NOT run vision-blind.
 *
 * `_previews` is stripped from the bulk history read (prompt-size), so after a
 * page reload (client sends no previewDataUrls) the route must re-fetch the
 * newest REAL cached bundle in a targeted single-row query — skipping legacy
 * rows that cached the 1×1 stub bundle — and hand it to the LLM parser as
 * importContext.previewDataUrls. Runs against the real DB so the jsonb filter
 * SQL is exercised for real; the LLM parser and mesh fetch are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '@/db'
import { users, projects, iterations } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { STUB_PREVIEW_BUNDLE } from '@/lib/design/preview-bundle'

let testUserId: string

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: testUserId } }),
}))

// Mock ONLY the LLM parser — capture its input to prove which previews it saw.
const parseDesignMock = vi.fn(async (_input: unknown) => ({
  kind: 'imported' as const,
  baseMeshUrl: 'http://mock/cube.3mf',
  edits: [{ op: 'scale' as const, factor: 0.5 }],
}))
vi.mock('@/lib/design/parse', () => ({
  parseDesign: (input: unknown) => parseDesignMock(input),
}))

// Serve the cube fixture for the base-mesh fetch.
vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
  if (typeof url === 'string' && url.includes('cube.3mf')) {
    const bytes = await readFile(join(__dirname, '../fixtures/cube-30mm.3mf'))
    return {
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
}))

const REAL_PREVIEWS = {
  top: 'data:image/png;base64,UkVBTFRPUA==',
  front: 'data:image/png;base64,UkVBTEZST05U',
  right: 'data:image/png;base64,UkVBTFJJR0hU',
  iso: 'data:image/png;base64,UkVBTElTTw==',
}

describe('/api/generate (cached previews after reload)', () => {
  let projectId: string

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `prev-${Date.now()}@example.com` })
      .returning()
    testUserId = u.id
    const [p] = await db.insert(projects).values({ userId: u.id, title: 't' }).returning()
    projectId = p.id

    // Older row: the original import, carrying REAL cached previews.
    await db.insert(iterations).values({
      projectId,
      userMessage: 'importa o cubo',
      status: 'ready',
      strategy: 'generative',
      meshBlobUrl: '/meshes/base.3mf',
      validationReport: {
        kind: 'imported',
        baseMeshUrl: 'http://mock/cube.3mf',
        edits: [{ op: 'scale', factor: 1 }],
        _faces: [],
        _previews: REAL_PREVIEWS,
      },
      createdAt: new Date(Date.now() - 60_000),
    })
    // Newer row: poisoned by the bug window — cached the 1×1 stub bundle. The
    // targeted re-fetch must SKIP it and fall back to the older real bundle.
    await db.insert(iterations).values({
      projectId,
      userMessage: 'grava o logo',
      status: 'ready',
      strategy: 'generative',
      meshBlobUrl: '/meshes/edit.3mf',
      validationReport: {
        kind: 'imported',
        baseMeshUrl: 'http://mock/cube.3mf',
        edits: [{ op: 'scale', factor: 1 }],
        _faces: [],
        _previews: { ...STUB_PREVIEW_BUNDLE },
      },
      createdAt: new Date(Date.now() - 30_000),
    })
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId))
    vi.unstubAllGlobals()
  })

  it('feeds the newest REAL cached bundle to the LLM (skips stub rows) and carries it forward', async () => {
    const { POST } = await import('@/app/api/generate/route')
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: 'diminui pela metade',
          // No meshUrl / previewDataUrls — the post-reload shape.
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.design.kind).toBe('imported')

    // The LLM parser saw the REAL previews, not the stub bundle.
    expect(parseDesignMock).toHaveBeenCalledTimes(1)
    const input = parseDesignMock.mock.calls[0][0] as {
      importContext?: { previewDataUrls: Record<string, string> }
    }
    expect(input.importContext?.previewDataUrls).toEqual(REAL_PREVIEWS)

    // Carry-forward: the NEW ready row caches the real bundle again, so the
    // next reload finds it as the newest real row.
    const [newest] = await db
      .select()
      .from(iterations)
      .where(eq(iterations.projectId, projectId))
      .orderBy(desc(iterations.createdAt))
      .limit(1)
    expect(newest.status).toBe('ready')
    const vr = newest.validationReport as { _previews?: Record<string, string> }
    expect(vr._previews).toEqual(REAL_PREVIEWS)
  })
})
