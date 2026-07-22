/**
 * Unit tests: GET /meshes/[file] — runtime-mesh serving route.
 *
 * External deps (auth, db, fs) are mocked. Validates the filename gate
 * (traversal never reaches the fs), the auth gate, ownership-scoped lookup
 * (non-owner → 404, not 403), and content-type/caching on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UUID = 'ec211884-b908-4057-b8d5-dba3fd9c28e2'

// ── Auth mock ────────────────────────────────────────────────────────────────
const authMock = vi.fn()
vi.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }))

// ── DB mock ──────────────────────────────────────────────────────────────────
// Route issues: db.select().from(iterations).innerJoin(projects).where(...).limit(1)
const limitMock = vi.fn(async () => [] as unknown[])
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: limitMock })),
        })),
      })),
    })),
  },
}))

// ── fs mock ──────────────────────────────────────────────────────────────────
const readFileMock = vi.fn()
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}))

const makeParams = (file: string) => ({ params: Promise.resolve({ file }) })
const req = new Request('http://localhost/meshes/x')

async function getRoute() {
  return import('@/app/meshes/[file]/route')
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: 'user-1' } })
  limitMock.mockReset().mockResolvedValue([])
  readFileMock.mockReset().mockResolvedValue(Buffer.from('solid'))
})

describe('GET /meshes/[file]', () => {
  it('rejects invalid names with 404 without touching fs or db', async () => {
    const { GET } = await getRoute()
    for (const bad of [
      'not-a-uuid.stl',
      `${UUID}.gcode`,
      `${UUID}.stl.exe`,
      'index.html',
      `${UUID}`, // no extension
    ]) {
      const res = await GET(req, makeParams(bad))
      expect(res.status, bad).toBe(404)
      const body = await res.json()
      expect(body.error.code).toBe('not_found')
    }
    expect(readFileMock).not.toHaveBeenCalled()
    expect(limitMock).not.toHaveBeenCalled()
  })

  it('rejects path traversal with 404 without touching fs', async () => {
    const { GET } = await getRoute()
    for (const bad of [
      '../../etc/passwd',
      `..%2F..%2F${UUID}.stl`,
      `../${UUID}.stl`, // decoded slash — basename() differs from raw param
      `..\\..\\${UUID}.stl`,
      `%2e%2e%2f${UUID}.stl`,
    ]) {
      const res = await GET(req, makeParams(bad))
      expect(res.status, bad).toBe(404)
    }
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null)
    const { GET } = await getRoute()
    const res = await GET(req, makeParams(`${UUID}.stl`))
    expect(res.status).toBe(401)
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the mesh belongs to another user', async () => {
    limitMock.mockResolvedValue([]) // ownership join found nothing
    const { GET } = await getRoute()
    const res = await GET(req, makeParams(`${UUID}.stl`))
    expect(res.status).toBe(404)
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('serves an owned .stl with model/stl + private immutable caching', async () => {
    limitMock.mockResolvedValue([{ id: 'iter-1' }])
    const { GET } = await getRoute()
    const res = await GET(req, makeParams(`${UUID}.stl`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('model/stl')
    // Auth-gated response: must be 'private' so shared caches (CDN/proxy)
    // never store and re-serve it to other clients bypassing the auth gates.
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('solid')
  })

  it('serves an owned .3mf with application/octet-stream', async () => {
    limitMock.mockResolvedValue([{ id: 'iter-1' }])
    const { GET } = await getRoute()
    const res = await GET(req, makeParams(`${UUID}.3mf`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('returns 404 when the file is missing on disk (ENOENT)', async () => {
    limitMock.mockResolvedValue([{ id: 'iter-1' }])
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { GET } = await getRoute()
    const res = await GET(req, makeParams(`${UUID}.stl`))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('not_found')
  })
})
