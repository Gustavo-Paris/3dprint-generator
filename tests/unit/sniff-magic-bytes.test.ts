import { describe, it, expect } from 'vitest'
import { sniffKind } from '@/lib/http/sniff-magic-bytes'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])

describe('sniffKind', () => {
  it('detects png/jpeg/webp as image', () => {
    expect(sniffKind(png)).toBe('image')
    expect(sniffKind(jpeg)).toBe('image')
    expect(sniffKind(webp)).toBe('image')
  })
  it('detects zip/3mf as mesh', () => {
    expect(sniffKind(zip)).toBe('mesh')
  })
  it('detects IFC STEP header as ifc', () => {
    const ifc = Buffer.from('ISO-10303-21;\nHEADER;')
    expect(sniffKind(ifc)).toBe('ifc')
  })
  it('returns null for unknown bytes', () => {
    expect(sniffKind(Buffer.from('not a real file'))).toBeNull()
  })
})
