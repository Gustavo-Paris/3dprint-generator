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

/** Weld a triangle-soup (9 floats per triangle) into indexed geometry: unique
 *  vertices + per-triangle indices. Coordinates are keyed at the same 4-decimal
 *  precision we serialize at, so coincident corners collapse to one vertex.
 *  Without this every triangle owns 3 private vertices, no edges are shared, and
 *  Bambu reports every edge as non-manifold (≈3× the triangle count). */
function weld(positions: Float32Array): { coords: number[]; indices: Uint32Array } {
  const vertCount = positions.length / 3
  const indexByKey = new Map<string, number>()
  const coords: number[] = []
  const indices = new Uint32Array(vertCount)

  for (let v = 0; v < vertCount; v++) {
    const o = v * 3
    const x = positions[o], y = positions[o + 1], z = positions[o + 2]
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    let idx = indexByKey.get(key)
    if (idx === undefined) {
      idx = coords.length / 3
      coords.push(x, y, z)
      indexByKey.set(key, idx)
    }
    indices[v] = idx
  }
  return { coords, indices }
}

/**
 * Serialize one or more mesh bodies into a 3MF that imports into Bambu Studio /
 * OrcaSlicer as a TRUE multi-colour model.
 *
 * Two things make this work where a naive 3MF doesn't:
 *  1. **Welded geometry.** Vertices are deduplicated so triangles share edges —
 *     otherwise the slicer flags the whole mesh as non-manifold.
 *  2. **Materials-extension colour group.** Each body's triangles reference an
 *     `<m:colorgroup>` colour via `pid`/`p1`. Bambu maps the two distinct colours
 *     to filament 1 and 2 on import (the "Standard 3MF Color Parsing" path). The
 *     core-spec `<basematerials>` resource is NOT honoured for filament mapping,
 *     which is why an earlier version loaded as a single colour.
 *
 * Bodies are emitted as separate `<object>`s grouped under one assembly object so
 * they import as a single model with coloured parts.
 */
export function serialize3mf(bodies: MeshBodyData[]): Uint8Array {
  // Resource ids share one namespace: colour group = 1, bodies = 2.., assembly last.
  const COLORGROUP_ID = 1
  let objectsXml = ''
  let componentsXml = ''
  let objectId = 2

  for (const body of bodies) {
    const currentId = objectId++
    componentsXml += `      <component objectid="${currentId}"/>\n`

    const { coords, indices } = weld(body.positions)
    const colorIndex = body.extruder === 'B' ? 1 : 0

    const vLines: string[] = []
    for (let i = 0; i < coords.length; i += 3) {
      vLines.push(`          <vertex x="${coords[i].toFixed(4)}" y="${coords[i + 1].toFixed(4)}" z="${coords[i + 2].toFixed(4)}"/>`)
    }

    const tLines: string[] = []
    for (let i = 0; i < indices.length; i += 3) {
      tLines.push(`          <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" pid="${COLORGROUP_ID}" p1="${colorIndex}"/>`)
    }

    objectsXml += `    <object id="${currentId}" type="model">
      <mesh>
        <vertices>
${vLines.join('\n')}
        </vertices>
        <triangles>
${tLines.join('\n')}
        </triangles>
      </mesh>
    </object>\n`
  }

  const assemblyId = objectId
  const parentObjectXml = `    <object id="${assemblyId}" type="model">
      <components>
${componentsXml}      </components>
    </object>\n`

  // Colour group: one <m:color> per extruder slot. Bambu maps unique colours to
  // sequential filaments. Order matters — index 0 = A (filament 1), 1 = B (2).
  const colorGroupXml =
    `    <m:colorgroup id="${COLORGROUP_ID}">\n` +
    `      <m:color color="${EXTRUDER_COLOURS.A}"/>\n` +
    `      <m:color color="${EXTRUDER_COLOURS.B}"/>\n` +
    `    </m:colorgroup>\n`

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
${colorGroupXml}${objectsXml}${parentObjectXml}  </resources>
  <build>
    <item objectid="${assemblyId}"/>
  </build>
</model>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  const encoder = new TextEncoder()
  return zipSync({
    '[Content_Types].xml': encoder.encode(contentTypesXml),
    '_rels/.rels': encoder.encode(relsXml),
    '3D/3dmodel.model': encoder.encode(modelXml),
  })
}
