import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateMeshFromImage } from '@/lib/meshy/client'

const ORIGINAL_FETCH = global.fetch

describe('generateMeshFromImage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('runs preview → refine 2-stage and downloads the refined mesh', async () => {
    let postCount = 0
    const pollCounts: Record<string, number> = { img_preview_1: 0, img_refine_2: 0 }

    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      // POST: 1st call creates preview task, 2nd call creates refine task
      if (url.endsWith('/openapi/v1/image-to-3d') && init?.method === 'POST') {
        postCount++
        const taskId = postCount === 1 ? 'img_preview_1' : 'img_refine_2'
        return Promise.resolve(new Response(JSON.stringify({ result: taskId }), { status: 200 }))
      }

      // Poll preview task
      if (url.endsWith('/openapi/v1/image-to-3d/img_preview_1')) {
        pollCounts.img_preview_1++
        if (pollCounts.img_preview_1 < 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 'img_preview_1', status: 'IN_PROGRESS', progress: 50 }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'img_preview_1', status: 'SUCCEEDED', progress: 100 }),
            { status: 200 },
          ),
        )
      }

      // Poll refine task
      if (url.endsWith('/openapi/v1/image-to-3d/img_refine_2')) {
        pollCounts.img_refine_2++
        if (pollCounts.img_refine_2 < 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 'img_refine_2', status: 'IN_PROGRESS', progress: 50 }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'img_refine_2',
              status: 'SUCCEEDED',
              progress: 100,
              model_urls: { obj: 'https://meshy.example/img_refine_2.obj' },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === 'https://meshy.example/img_refine_2.obj') {
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
      expect(r.stl.byteLength).toBe(84 + 50) // 1 triangle binary STL
      expect(r.meta.task_id).toBe('img_refine_2')
    }
    expect(postCount).toBe(2) // preview + refine
    global.fetch = ORIGINAL_FETCH
  })
})
