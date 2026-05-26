import { auth } from '@/auth'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_IMAGE = 5 * 1024 * 1024  // 5MB for images
const MAX_BYTES_MESH = 50 * 1024 * 1024  // 50MB for 3MF
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MESH_TYPES = [
  'model/3mf',
  'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  'application/octet-stream', // some browsers send this for .3mf
]

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthenticated', { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return new Response('No file', { status: 400 })

  const isMesh = MESH_TYPES.includes(file.type) || file.name.toLowerCase().endsWith('.3mf')
  const isImage = IMAGE_TYPES.includes(file.type)

  if (!isMesh && !isImage) {
    return new Response(`Unsupported type ${file.type}`, { status: 415 })
  }

  const limit = isMesh ? MAX_BYTES_MESH : MAX_BYTES_IMAGE
  if (file.size > limit) {
    const mb = (limit / 1024 / 1024).toFixed(0)
    return new Response(`File too large (>${mb}MB)`, { status: 413 })
  }

  const ext = isMesh ? '3mf'
    : file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : 'jpg'
  const id = randomUUID()
  const bytes = Buffer.from(await file.arrayBuffer())

  let url: string
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${session.user.id}/uploads/${id}.${ext}`, bytes, {
      access: 'public',
      addRandomSuffix: false,
      contentType: isMesh ? 'application/octet-stream' : file.type,
    })
    url = blob.url
  } else {
    const dir = join(process.cwd(), 'public', 'uploads')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${id}.${ext}`), bytes)
    url = `/uploads/${id}.${ext}`
  }

  return Response.json({ url, content_type: file.type, size: bytes.length })
}
