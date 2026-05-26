import { describe, it, expect } from 'vitest'
import { Design } from '@/lib/design/schema'

describe('Design.imported variant', () => {
  it('parses minimal imported design with one edit', () => {
    const input = {
      kind: 'imported',
      baseMeshUrl: 'https://blob.example.com/mesh.3mf',
      edits: [
        { op: 'scale', factor: 0.5 },
      ],
    }
    const result = Design.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.kind).toBe('imported')
  })

  it('parses all five ops', () => {
    const input = {
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [
        { op: 'scale', factor: 1.2 },
        { op: 'hole', faceId: 0, shape: 'circle', diameterMm: 3.2, depthMm: 'through', positions: [[10, 10]] },
        { op: 'add_logo', faceId: 1, imageUrl: 'https://x/l.png', sizeMm: 30, depthMm: 0.6 },
        { op: 'emboss_text', faceId: 1, text: 'HELLO', treatment: 'embossed', sizeMm: 8, depthMm: 0.5 },
        { op: 'jscad_raw', code: 'module.exports={main:()=>jscad.primitives.cube({size:10})}' },
      ],
    }
    expect(Design.safeParse(input).success).toBe(true)
  })

  it('rejects unknown op', () => {
    const input = {
      kind: 'imported',
      baseMeshUrl: 'https://x/y.3mf',
      edits: [{ op: 'levitate', amount: 9000 }],
    }
    expect(Design.safeParse(input).success).toBe(false)
  })
})
