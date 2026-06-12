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

  it('unlinks a local /meshes path', async () => {
    await delMesh('/meshes/abc.stl')
    expect(unlink).toHaveBeenCalledTimes(1)
    expect(unlink.mock.calls[0][0]).toContain('public/meshes/abc.stl')
    expect(del).not.toHaveBeenCalled()
  })

  it('calls @vercel/blob del() for an http blob url', async () => {
    await delMesh('https://blob.example.com/u/p/i.3mf')
    expect(del).toHaveBeenCalledWith('https://blob.example.com/u/p/i.3mf', expect.anything())
  })
})
