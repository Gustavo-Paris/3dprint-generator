import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateMeshFromImage } from '@/lib/meshy/client'

const ORIGINAL_FETCH = global.fetch

describe('generateMeshFromImage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('runs single-stage image-to-3d and downloads the mesh', async () => {
    let postCount = 0
    let pollCount = 0

    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.endsWith('/openapi/v1/image-to-3d') && init?.method === 'POST') {
        postCount++
        return Promise.resolve(new Response(JSON.stringify({ result: 'img_task_1' }), { status: 200 }))
      }

      if (url.endsWith('/openapi/v1/image-to-3d/img_task_1')) {
        pollCount++
        if (pollCount < 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 'img_task_1', status: 'IN_PROGRESS', progress: 50 }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'img_task_1',
              status: 'SUCCEEDED',
              progress: 100,
              model_urls: { obj: 'https://meshy.example/img_task_1.obj' },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === 'https://meshy.example/img_task_1.obj') {
        return Promise.resolve(
          new Response('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', { status: 200 }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    }) as typeof global.fetch

    const promise = generateMeshFromImage({
      imageUrl: 'https://example.com/helmet.png',
      apiKey: 'msy_test',
    })
    await vi.runAllTimersAsync()
    const r = await promise

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.stl.byteLength).toBe(84 + 50)
      expect(r.meta.task_id).toBe('img_task_1')
    }
    expect(postCount).toBe(1) // single-stage, no refine
    global.fetch = ORIGINAL_FETCH
  })
})
