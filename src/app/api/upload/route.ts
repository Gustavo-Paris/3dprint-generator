import { auth } from '@/auth'
import { env } from '@/env'
import { apiError } from '@/lib/http/api-error'
import { sniffKind } from '@/lib/http/sniff-magic-bytes'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_IMAGE = 5 * 1024 * 1024  // 5MB for images
const MAX_BYTES_MESH = 50 * 1024 * 1024  // 50MB for 3MF
const MAX_BYTES_IFC = 80 * 1024 * 1024   // 80MB for IFC BIM
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MESH_TYPES = [
  'model/3mf',
  'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  'application/octet-stream', // some browsers send this for .3mf
]

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, 'unauthenticated', 'Faça login para continuar.')

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return apiError(400, 'no_file', 'Nenhum arquivo enviado.')

  const nameLower = file.name.toLowerCase()
  const isIfc = nameLower.endsWith('.ifc')
  const isMesh = !isIfc && (MESH_TYPES.includes(file.type) || nameLower.endsWith('.3mf'))
  const isImage = IMAGE_TYPES.includes(file.type)

  if (!isMesh && !isImage && !isIfc) {
    return apiError(415, 'unsupported_type', 'Tipo de arquivo não suportado. Use .3mf, .ifc ou imagem.')
  }

  const limit = isIfc ? MAX_BYTES_IFC : isMesh ? MAX_BYTES_MESH : MAX_BYTES_IMAGE
  if (file.size > limit) {
    const mb = (limit / 1024 / 1024).toFixed(0)
    return apiError(413, 'file_too_large', `Arquivo muito grande (>${mb}MB).`)
  }

  const ext = isIfc ? 'ifc'
    : isMesh ? '3mf'
    : file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : 'jpg'
  const id = randomUUID()
  const bytes = Buffer.from(await file.arrayBuffer())

  // Don't trust the browser MIME/extension — verify the leading bytes match.
  const sniffed = sniffKind(bytes)
  if (sniffed === null) {
    return apiError(415, 'content_mismatch', 'O conteúdo do arquivo não corresponde ao tipo declarado.')
  }
  if (isMesh && sniffed !== 'mesh') {
    return apiError(415, 'content_mismatch', 'O conteúdo do arquivo não corresponde ao tipo declarado.')
  }
  if (isImage && sniffed !== 'image') {
    return apiError(415, 'content_mismatch', 'O conteúdo do arquivo não corresponde ao tipo declarado.')
  }
  if (isIfc && sniffed !== 'ifc') {
    return apiError(415, 'content_mismatch', 'Arquivo IFC inválido (esperado ISO-10303-21).')
  }

  let url: string
  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${session.user.id}/uploads/${id}.${ext}`, bytes, {
      access: 'public',
      addRandomSuffix: false,
      contentType: isMesh || isIfc ? 'application/octet-stream' : file.type,
    })
    url = blob.url
  } else {
    const dir = join(process.cwd(), 'public', 'uploads')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${id}.${ext}`), bytes)
    url = `/uploads/${id}.${ext}`
  }

  return Response.json({
    url,
    content_type: file.type,
    size: bytes.length,
    kind: isIfc ? 'ifc' : isMesh ? 'mesh' : 'image',
  })
}
