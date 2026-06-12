import { describe, it, expect } from 'vitest'
import { serialize3mf, MeshBodyData } from '@/lib/3mf/serialize-3mf'
import { parse3mf } from '@/lib/3mf/parse-3mf'

describe('3MF serialization and parsing roundtrip', () => {
  it('serializes multiple bodies to 3MF and parses them back correctly', () => {
    // 2 triangles for body A (cube face)
    const positionsA = new Float32Array([
      0, 0, 0,  10, 0, 0,  10, 10, 0,
      0, 0, 0,  10, 10, 0,  0, 10, 0,
    ])
    // 1 triangle for body B
    const positionsB = new Float32Array([
      0, 0, 5,  5, 0, 5,  5, 5, 5,
    ])

    const originalBodies: MeshBodyData[] = [
      {
        positions: positionsA,
        extruder: 'A',
        label: 'Body',
      },
      {
        positions: positionsB,
        extruder: 'B',
        label: 'Logo',
      },
    ]

    const zipBytes = serialize3mf(originalBodies)
    expect(zipBytes).toBeInstanceOf(Uint8Array)
    expect(zipBytes.length).toBeGreaterThan(100)

    const parsedBodies = parse3mf(zipBytes)
    expect(parsedBodies).toHaveLength(2)

    expect(parsedBodies[0].extruder).toBe('A')
    expect(parsedBodies[0].positions).toHaveLength(18)
    expect(Array.from(parsedBodies[0].positions)).toEqual(Array.from(positionsA))

    expect(parsedBodies[1].extruder).toBe('B')
    expect(parsedBodies[1].positions).toHaveLength(9)
    expect(Array.from(parsedBodies[1].positions)).toEqual(Array.from(positionsB))
  })

  it('roundtrips a large single-body mesh without reordering vertices', () => {
    // 2000 triangles → 18000 floats. Exercises the preallocated index-write path.
    const TRI = 2000
    const positions = new Float32Array(TRI * 9)
    for (let i = 0; i < positions.length; i++) {
      // deterministic, non-degenerate coords (avoid all-zero triangles)
      positions[i] = ((i * 7) % 333) + (i % 9) * 0.5
    }

    const original: MeshBodyData[] = [{ positions, extruder: 'A', label: 'Big' }]

    const zipBytes = serialize3mf(original)
    const parsed = parse3mf(zipBytes)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].positions).toBeInstanceOf(Float32Array)
    // 9 floats per triangle, no dropped/duplicated vertices
    expect(parsed[0].positions).toHaveLength(TRI * 9)
    // exact ordering preserved (serialize writes indexed verts; parse must
    // re-expand in the same triangle order)
    expect(Array.from(parsed[0].positions)).toEqual(Array.from(positions))
  })
})
