import { zipSync } from 'fflate'

export interface MeshBodyData {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

/** Colour for each extruder, written into the 3MF colour group. Index 0 =
 *  extruder A (body), index 1 = extruder B (logo). Bambu/Orca map each UNIQUE
 *  colour to a sequential filament (1, 2, …) on import, so these two distinct
 *  colours become filament 1 and filament 2. Format is #RRGGBBAA. */
const EXTRUDER_COLOURS: Record<'A' | 'B', string> = {
  A: '#3B82F6FF', // blue body  → filament 1
  B: '#22C55EFF', // green logo → filament 2
}

/** 0.0001 mm grid — matches the 4-decimal `toFixed` we write into the 3MF XML. */
export const WELD_SCALE = 10_000

/**
 * Weld a triangle-soup into indexed geometry.
 *
 * Critical details (BUG: white slicer spikes on every download):
 *  1. Store QUANTIZED coordinates (not the raw float).
 *  2. Drop triangles that become degenerate after welding.
 *  3. String keys only — packed numeric keys overflow JS float precision and
 *     silently merge distant verts → non-manifold junk.
 */
export function weldMeshSoup(positions: Float32Array): {
  coords: number[]
  /** Flat list of triangle corner indices (length multiple of 3). Degens removed. */
  indices: number[]
} {
  const vertCount = positions.length / 3
  const indexByKey = new Map<string, number>()
  const coords: number[] = []
  const rawIndices = new Uint32Array(vertCount)
  const SCALE = WELD_SCALE

  for (let v = 0; v < vertCount; v++) {
    const o = v * 3
    const ix = Math.round(positions[o] * SCALE)
    const iy = Math.round(positions[o + 1] * SCALE)
    const iz = Math.round(positions[o + 2] * SCALE)
    const x = ix / SCALE
    const y = iy / SCALE
    const z = iz / SCALE
    const key = `${ix},${iy},${iz}`
    let idx = indexByKey.get(key)
    if (idx === undefined) {
      idx = coords.length / 3
      coords.push(x, y, z)
      indexByKey.set(key, idx)
    }
    rawIndices[v] = idx
  }

  const indices: number[] = []
  for (let i = 0; i < rawIndices.length; i += 3) {
    const a = rawIndices[i]
    const b = rawIndices[i + 1]
    const c = rawIndices[i + 2]
    if (a === b || b === c || a === c) continue
    indices.push(a, b, c)
  }
  return { coords, indices }
}

/**
 * Weld several bodies into ONE shared vertex buffer, keeping per-triangle
 * colour indices (0 = A, 1 = B). Degenerate tris dropped.
 */
export function weldBodiesMultiColor(bodies: MeshBodyData[]): {
  coords: number[]
  /** triples of vertex indices */
  indices: number[]
  /** one colour index per triangle (same length as indices/3) */
  colorIndexPerTri: number[]
} {
  const indexByKey = new Map<string, number>()
  const coords: number[] = []
  const indices: number[] = []
  const colorIndexPerTri: number[] = []
  const SCALE = WELD_SCALE

  const vert = (x0: number, y0: number, z0: number): number => {
    const ix = Math.round(x0 * SCALE)
    const iy = Math.round(y0 * SCALE)
    const iz = Math.round(z0 * SCALE)
    const key = `${ix},${iy},${iz}`
    let idx = indexByKey.get(key)
    if (idx === undefined) {
      idx = coords.length / 3
      coords.push(ix / SCALE, iy / SCALE, iz / SCALE)
      indexByKey.set(key, idx)
    }
    return idx
  }

  for (const body of bodies) {
    const colorIndex = body.extruder === 'B' ? 1 : 0
    const p = body.positions
    for (let i = 0; i < p.length; i += 9) {
      const a = vert(p[i], p[i + 1], p[i + 2])
      const b = vert(p[i + 3], p[i + 4], p[i + 5])
      const c = vert(p[i + 6], p[i + 7], p[i + 8])
      if (a === b || b === c || a === c) continue
      indices.push(a, b, c)
      colorIndexPerTri.push(colorIndex)
    }
  }
  return { coords, indices, colorIndexPerTri }
}

export interface Serialize3mfOptions {
  /** Colour per extruder as '#RRGGBB' — written into the colour group with an
   *  opaque alpha ('#RRGGBBFF'). Omitted = the historical defaults above. */
  colors?: { aHex: string; bHex: string }
  /** When truthy, embedded verbatim (JSON) as `Metadata/project_settings.config`
   *  so Bambu Studio opens the file with the full print profile pre-applied. */
  projectSettings?: Record<string, unknown> | null
}

/**
 * Serialize one or more mesh bodies into a 3MF that imports into Bambu Studio /
 * OrcaSlicer as a TRUE multi-colour model.
 *
 * Multi-body is written as a **single mesh object** with per-triangle colours
 * (Standard 3MF Color Parsing). Emitting separate component objects made Bambu
 * treat the logo as a free-floating part → "floating cantilever" + white dots
 * even when each body was individually watertight.
 *
 * Also writes `Metadata/model_settings.config` so re-import preserves extruder
 * assignment for tools that prefer that path.
 *
 * With no `opts` the output is byte-identical to the historical behaviour
 * (default colours, no project_settings entry).
 */
export function serialize3mf(bodies: MeshBodyData[], opts?: Serialize3mfOptions): Uint8Array {
  const COLORGROUP_ID = 1
  const OBJECT_ID = 2

  const colourA = opts?.colors ? `${opts.colors.aHex}FF` : EXTRUDER_COLOURS.A
  const colourB = opts?.colors ? `${opts.colors.bHex}FF` : EXTRUDER_COLOURS.B

  const { coords, indices, colorIndexPerTri } = weldBodiesMultiColor(bodies)

  const vLines: string[] = []
  for (let i = 0; i < coords.length; i += 3) {
    vLines.push(
      `          <vertex x="${coords[i].toFixed(4)}" y="${coords[i + 1].toFixed(4)}" z="${coords[i + 2].toFixed(4)}"/>`,
    )
  }

  const tLines: string[] = []
  for (let t = 0; t < colorIndexPerTri.length; t++) {
    const i = t * 3
    tLines.push(
      `          <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" pid="${COLORGROUP_ID}" p1="${colorIndexPerTri[t]}"/>`,
    )
  }

  const colorGroupXml =
    `    <m:colorgroup id="${COLORGROUP_ID}">\n` +
    `      <m:color color="${colourA}"/>\n` +
    `      <m:color color="${colourB}"/>\n` +
    `    </m:colorgroup>\n`

  const objectXml = `    <object id="${OBJECT_ID}" type="model">
      <mesh>
        <vertices>
${vLines.join('\n')}
        </vertices>
        <triangles>
${tLines.join('\n')}
        </triangles>
      </mesh>
    </object>\n`

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
${colorGroupXml}${objectXml}  </resources>
  <build>
    <item objectid="${OBJECT_ID}"/>
  </build>
</model>`

  // Bambu multi-material metadata: one object, parts map to filament slots.
  // Extruder 1 = A (body), 2 = B (logo). Even with a single mesh object this
  // helps tools that read model_settings on re-import.
  const hasB = bodies.some((b) => b.extruder === 'B')
  const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${OBJECT_ID}">
    <metadata key="name" value="model"/>
    <metadata key="extruder" value="1"/>
    <part id="${OBJECT_ID}">
      <metadata key="name" value="${hasB ? 'Multi-color body' : 'Body'}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="1"/>
    </part>
  </object>
</config>
`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  const encoder = new TextEncoder()
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(contentTypesXml),
    '_rels/.rels': encoder.encode(relsXml),
    '3D/3dmodel.model': encoder.encode(modelXml),
    'Metadata/model_settings.config': encoder.encode(modelSettingsXml),
  }
  if (opts?.projectSettings) {
    entries['Metadata/project_settings.config'] = encoder.encode(
      JSON.stringify(opts.projectSettings),
    )
  }
  return zipSync(entries, { level: 1 })
}
