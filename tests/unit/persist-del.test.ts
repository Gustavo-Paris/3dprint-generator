import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so the mock fns exist before the hoisted vi.mock factories run.
const { del, unlink } = vi.hoisted(() => ({
  del: vi.fn(async (_url: string, _opts?: unknown) => {}),
  unlink: vi.fn(async (_p: string) => {}),
}))
vi.mock('@vercel/blob', () => ({ del }))
vi.mock('node:fs/promises', async (orig) => ({ ...(await orig<typeof import('node:fs/promises')>()), unlink }))

import { delMesh } from '@/lib/storage/persist'

describe('delMesh', () => {
  beforeEach(() => { del.mockClear(); unlink.mockClear() })

  it('unlinks a local /meshes path (private store + legacy public)', async () => {
    await delMesh('/meshes/abc.stl')
    // Primary private path, then best-effort legacy public/meshes copy.
    expect(unlink.mock.calls.length).toBeGreaterThanOrEqual(1)
    const paths = unlink.mock.calls.map((c) => String(c[0]))
    expect(paths.some((p) => p.includes('abc.stl'))).toBe(true)
    expect(del).not.toHaveBeenCalled()
  })

  it('calls @vercel/blob del() for an http blob url', async () => {
    await delMesh('https://blob.example.com/u/p/i.3mf')
    expect(del).toHaveBeenCalledWith('https://blob.example.com/u/p/i.3mf', expect.anything())
  })
})
