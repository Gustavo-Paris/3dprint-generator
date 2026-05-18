import { auth } from '@/auth'
import { previewLogo } from '@/lib/logo-extrude/preview'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const runtime = 'nodejs'

const Body = z.object({
  imageUrl: z.string(),
  cropBox: z
    .object({
      left: z.number(),
      top: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  threshold: z.number().min(0).max(255).optional(),
  forceInvert: z.boolean().optional(),
  skipTrim: z.boolean().optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return new Response('Invalid body', { status: 400 })

  const { imageUrl, cropBox, threshold, forceInvert, skipTrim } = parsed.data

  // Resolve image bytes
  let buffer: Buffer
  try {
    if (imageUrl.startsWith('http')) {
      const res = await fetch(imageUrl)
      if (!res.ok) throw new Error(`Image fetch ${res.status}`)
      buffer = Buffer.from(await res.arrayBuffer())
    } else if (imageUrl.startsWith('/uploads/')) {
      buffer = await readFile(join(process.cwd(), 'public', imageUrl))
    } else {
      return new Response('Unrecognized imageUrl', { status: 400 })
    }
  } catch (err) {
    return new Response(`Could not read image: ${(err as Error).message}`, { status: 502 })
  }

  try {
    const result = await previewLogo({ imageBuffer: buffer, cropBox, threshold, forceInvert, skipTrim })
    return new Response(new Uint8Array(result.pngBuffer), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'x-preview-width': String(result.width),
        'x-preview-height': String(result.height),
        'x-preview-inverted': String(result.inverted),
        'x-preview-threshold': String(result.thresholdApplied),
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[logo-preview] failed:', err)
    return new Response(`Preview failed: ${(err as Error).message}`, { status: 500 })
  }
}
