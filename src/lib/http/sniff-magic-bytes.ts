/** Identify a file by its leading bytes (don't trust browser MIME). */
export function sniffKind(buf: Uint8Array): 'image' | 'mesh' | null {
  const b = buf
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'
  // JPEG: FF D8
  if (b[0] === 0xff && b[1] === 0xd8) return 'image'
  // WebP: 'RIFF' .... 'WEBP'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image'
  // ZIP / 3MF (OPC): 'PK'
  if (b[0] === 0x50 && b[1] === 0x4b) return 'mesh'
  return null
}
