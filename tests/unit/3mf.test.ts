import { describe, it, expect } from 'vitest'
import { zipSync, unzipSync } from 'fflate'
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
      { positions: positionsA, extruder: 'A', label: 'Body' },
      { positions: positionsB, extruder: 'B', label: 'Logo' },
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

  it('emits a colour group with one colour per extruder, referenced per-triangle', () => {
    const bodies: MeshBodyData[] = [
      { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), extruder: 'A', label: 'Body' },
      { positions: new Float32Array([0, 0, 1, 1, 0, 1, 1, 1, 1]), extruder: 'B', label: 'Logo' },
    ]

    const model = new TextDecoder().decode(unzipSync(serialize3mf(bodies))['3D/3dmodel.model'])

    // Materials-extension colour group (what Bambu maps to filaments), NOT the
    // core-spec basematerials (which Bambu ignores → single colour).
    expect(model).toContain('<m:colorgroup')
    expect(model).not.toContain('basematerials')
    const colors = model.match(/<m:color\s+color="[^"]+"/g) ?? []
    expect(colors).toHaveLength(2)

    // Body triangles point at colour index 0, logo triangles at index 1.
    expect(model).toMatch(/<triangle[^>]*pid="1"\s+p1="0"/)
    expect(model).toMatch(/<triangle[^>]*pid="1"\s+p1="1"/)
  })

  it('welds coincident vertices so the mesh is not a non-manifold soup', () => {
    // A quad as two triangles shares 2 corners → 4 unique vertices, not 6.
    const quad = new Float32Array([
      0, 0, 0,  10, 0, 0,  10, 10, 0,
      0, 0, 0,  10, 10, 0,  0, 10, 0,
    ])
    const model = new TextDecoder().decode(
      unzipSync(serialize3mf([{ positions: quad, extruder: 'A', label: 'Quad' }]))['3D/3dmodel.model'],
    )
    const verts = model.match(/<vertex\s/g) ?? []
    expect(verts).toHaveLength(4) // welded (would be 6 unwelded)
  })

  it('roundtrips a large single-body mesh without reordering vertices', () => {
    // 2000 triangles → 18000 floats. Exercises the preallocated index-write path.
    const TRI = 2000
    const positions = new Float32Array(TRI * 9)
    for (let i = 0; i < positions.length; i++) {
      positions[i] = ((i * 7) % 333) + (i % 9) * 0.5
    }

    const original: MeshBodyData[] = [{ positions, extruder: 'A', label: 'Big' }]

    const zipBytes = serialize3mf(original)
    const parsed = parse3mf(zipBytes)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].positions).toBeInstanceOf(Float32Array)
    expect(parsed[0].positions).toHaveLength(TRI * 9)
    expect(Array.from(parsed[0].positions)).toEqual(Array.from(positions))
  })

  it('still reads extruder from legacy p1 meshes (no model_settings.config)', () => {
    // A pre-change 3MF: core-spec per-triangle p1 marks the body, no config file.
    const legacyModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="2" type="model"><mesh>
      <vertices>
        <vertex x="0" y="0" z="5"/><vertex x="5" y="0" z="5"/><vertex x="5" y="5" z="5"/>
      </vertices>
      <triangles>
        <triangle v1="0" v2="1" v3="2" pid="1" p1="1"/>
      </triangles>
    </mesh></object>
  </resources>
  <build><item objectid="2"/></build>
</model>`
    const enc = new TextEncoder()
    const zip = zipSync({ '3D/3dmodel.model': enc.encode(legacyModel) })

    const parsed = parse3mf(zip)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].extruder).toBe('B')
  })
})
