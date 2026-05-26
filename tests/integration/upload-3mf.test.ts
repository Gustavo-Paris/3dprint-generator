import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/upload/route'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'test-user' } })),
}))

function makeForm(blob: Blob, name = 'cube.3mf'): FormData {
  const fd = new FormData()
  fd.set('file', blob, name)
  return fd
}

describe('POST /api/upload', () => {
  it('accepts a .3mf file', async () => {
    const fd = makeForm(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
      type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    }))
    const req = new Request('http://x/upload', { method: 'POST', body: fd })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content_type).toMatch(/3dmanufacturing|3mf|zip|octet/)
  })

  it('rejects 3MF over 50MB', async () => {
    const big = new Uint8Array(51 * 1024 * 1024)
    const fd = makeForm(new Blob([big], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }))
    const req = new Request('http://x/upload', { method: 'POST', body: fd })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
