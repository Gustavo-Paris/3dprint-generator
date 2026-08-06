import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1' } })),
}))

describe('POST /api/print-bambu', () => {
  beforeEach(() => {
    delete process.env.BAMBU_LAN_ENABLED
    delete process.env.BAMBU_LAN_HOST
    delete process.env.BAMBU_LAN_SERIAL
    delete process.env.BAMBU_LAN_ACCESS_CODE
    vi.resetModules()
  })

  it('returns dry_run not_configured when LAN env is missing', async () => {
    const { POST } = await import('@/app/api/print-bambu/route')
    const res = await POST(
      new Request('http://localhost/api/print-bambu', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dry_run).toBe(true)
    expect(body.status).toBe('not_configured')
    expect(body.checklist.length).toBeGreaterThan(2)
  })
})
