import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateMesh } from '@/lib/meshy/client'

const ORIGINAL_FETCH = global.fetch

describe('generateMesh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('polls until SUCCEEDED and downloads the mesh', async () => {
    let pollCount = 0
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/openapi/v2/text-to-3d') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ result: 'task_123' }), { status: 200 }))
      }
      if (url.endsWith('/openapi/v2/text-to-3d/task_123')) {
        pollCount++
        if (pollCount < 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 'task_123', status: 'IN_PROGRESS', progress: 50 }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task_123',
              status: 'SUCCEEDED',
              progress: 100,
              model_urls: { obj: 'https://meshy.example/task_123.obj' },
            }),
            { status: 200 },
          ),
        )
      }
      if (url === 'https://meshy.example/task_123.obj') {
        // Minimal OBJ: 1 triangle
        return Promise.resolve(new Response('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    }) as typeof global.fetch

    const promise = generateMesh({ prompt: 'iron man helmet', apiKey: 'msy_test' })
    await vi.runAllTimersAsync()
    const r = await promise

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.stl.byteLength).toBe(84 + 50) // 1 triangle binary STL
      expect(r.meta.task_id).toBe('task_123')
    }
    global.fetch = ORIGINAL_FETCH
  })
})
