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

    const zip = unzipSync(serialize3mf(bodies))
    const model = new TextDecoder().decode(zip['3D/3dmodel.model'])

    // Materials-extension colour group (what Bambu maps to filaments), NOT the
    // core-spec basematerials (which Bambu ignores → single colour).
    expect(model).toContain('<m:colorgroup')
    expect(model).not.toContain('basematerials')
    const colors = model.match(/<m:color\s+color="[^"]+"/g) ?? []
    expect(colors).toHaveLength(2)

    // Body triangles point at colour index 0, logo triangles at index 1.
    expect(model).toMatch(/<triangle[^>]*pid="1"\s+p1="0"/)
    expect(model).toMatch(/<triangle[^>]*pid="1"\s+p1="1"/)

    // Single mesh object — multi-object assemblies make Bambu treat the logo
    // as a floating cantilever part.
    expect((model.match(/<object /g) ?? []).length).toBe(1)
    expect(model).not.toContain('<components>')
    expect(zip['Metadata/model_settings.config']).toBeTruthy()
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

  it('roundtrips a large single-body mesh at 0.0001 mm precision', () => {
    // 2000 triangles → 18000 floats. Coordinates snap to 4 decimals on write
    // (print resolution); topology must survive.
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
    // Some near-degenerate tris may be dropped after weld; count stays close.
    expect(parsed[0].positions.length).toBeGreaterThan(TRI * 9 * 0.9)
    expect(parsed[0].positions.length % 9).toBe(0)
    // Every surviving coordinate is on the 0.0001 mm grid.
    for (let i = 0; i < parsed[0].positions.length; i++) {
      const q = Math.round(parsed[0].positions[i] * 10000) / 10000
      expect(parsed[0].positions[i]).toBeCloseTo(q, 6)
    }
  })

  it('roundtrips a real watertight mesh without inventing non-manifold edges', async () => {
    // Regression: weld used to store raw floats then toFixed(4) on write, which
    // re-collapsed distinct verts and made Bambu paint the model with white spikes.
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { loadBaseMeshFromBytes } = await import('@/lib/import/load-base-mesh')
    const { analyzeMeshValidity } = await import('@/lib/mesh/validity')

    const bytes = new Uint8Array(
      await readFile(join(__dirname, '../fixtures/cube-30mm.3mf')),
    )
    const base = await loadBaseMeshFromBytes(bytes)
    const before = analyzeMeshValidity(base.positions, { maxTriangles: 2_000_000 })
    expect(before.watertight).toBe(true)

    const zipBytes = serialize3mf([
      { positions: base.positions, extruder: 'A', label: 'Body' },
    ])
    const round = await loadBaseMeshFromBytes(zipBytes)
    const after = analyzeMeshValidity(round.positions, { maxTriangles: 2_000_000 })
    expect(after.degenerateTriangles).toBe(0)
    expect(after.nonManifoldEdges).toBe(0)
    expect(after.watertight).toBe(true)
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

  it('roundtrips a fully accent-painted mesh (all triangles B) as extruder B', () => {
    // serialize3mf always writes part extruder="1" in model_settings.config;
    // explicit per-triangle p1 must win or an all-B mesh re-imports as A.
    const allB = serialize3mf([
      { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), extruder: 'B', label: 'logo' },
    ])
    const parsed = parse3mf(allB)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].extruder).toBe('B')
  })
})

describe('serialize3mf opts (colors + embedded project settings)', () => {
  const bodies: MeshBodyData[] = [
    { positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]), extruder: 'A', label: 'Body' },
    { positions: new Float32Array([0, 0, 5, 5, 0, 5, 5, 5, 5]), extruder: 'B', label: 'Logo' },
  ]

  it('embeds opts.projectSettings as Metadata/project_settings.config', () => {
    const projectSettings = {
      layer_height: '0.16',
      filament_colour: ['#FFFFFFFF', '#22C55E', '#3B82F6'],
      brim_type: 'outer_only',
    }
    const zip = unzipSync(serialize3mf(bodies, { projectSettings }))

    const entry = zip['Metadata/project_settings.config']
    expect(entry).toBeTruthy()
    expect(JSON.parse(new TextDecoder().decode(entry))).toEqual(projectSettings)

    // Re-import must keep working — parse3mf ignores the extra entry.
    const parsed = parse3mf(serialize3mf(bodies, { projectSettings }))
    expect(parsed).toHaveLength(2)
    expect(parsed[0].extruder).toBe('A')
    expect(parsed[1].extruder).toBe('B')
  })

  it('opts.colors changes the colorgroup colours (with FF alpha) and round-trips', () => {
    const bytes = serialize3mf(bodies, { colors: { aHex: '#112233', bHex: '#AABBCC' } })
    const model = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model'])

    expect(model).toContain('<m:color color="#112233FF"/>')
    expect(model).toContain('<m:color color="#AABBCCFF"/>')
    expect(model).not.toContain('#3B82F6FF')
    expect(model).not.toContain('#22C55EFF')

    // A/B still map by per-triangle colour index (p1), regardless of the hex.
    const parsed = parse3mf(bytes)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].extruder).toBe('A')
    expect(Array.from(parsed[0].positions)).toEqual(Array.from(bodies[0].positions))
    expect(parsed[1].extruder).toBe('B')
    expect(Array.from(parsed[1].positions)).toEqual(Array.from(bodies[1].positions))
  })

  it('without opts the output matches the legacy layout exactly', () => {
    const zip = unzipSync(serialize3mf(bodies))

    // Exactly the four historical entries — no project_settings.config.
    expect(Object.keys(zip).sort()).toEqual([
      '3D/3dmodel.model',
      'Metadata/model_settings.config',
      '[Content_Types].xml',
      '_rels/.rels',
    ])

    // Legacy default colours (blue body / green logo).
    const model = new TextDecoder().decode(zip['3D/3dmodel.model'])
    expect(model).toContain('<m:color color="#3B82F6FF"/>')
    expect(model).toContain('<m:color color="#22C55EFF"/>')

    // Passing the defaults explicitly yields the same content per entry —
    // i.e. omitting opts is exactly the default-colour path with no extras.
    const explicit = unzipSync(
      serialize3mf(bodies, { colors: { aHex: '#3B82F6', bHex: '#22C55E' } }),
    )
    expect(Object.keys(explicit).sort()).toEqual(Object.keys(zip).sort())
    for (const name of Object.keys(zip)) {
      expect(Array.from(explicit[name])).toEqual(Array.from(zip[name]))
    }
  })
})
