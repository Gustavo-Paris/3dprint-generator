import { zipSync } from 'fflate'

export interface MeshBodyData {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

export function serialize3mf(bodies: MeshBodyData[]): Uint8Array {
  // Generate [Content_Types].xml
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

  // Generate _rels/.rels
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  // Generate 3D/3dmodel.model XML
  let objectsXml = ''
  let componentsXml = ''
  let objectId = 2 // Parent object will be ID 1

  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b]
    const currentId = objectId++
    componentsXml += `      <component objectid="${currentId}"/>\n`

    let verticesXml = ''
    let trianglesXml = ''
    const p1 = body.extruder === 'B' ? '1' : '0'

    // Mesh vertices & triangles
    const pos = body.positions
    const vertCount = pos.length / 3

    for (let i = 0; i < pos.length; i += 3) {
      verticesXml += `          <vertex x="${pos[i].toFixed(4)}" y="${pos[i + 1].toFixed(4)}" z="${pos[i + 2].toFixed(4)}"/>\n`
    }

    const triCount = vertCount / 3
    for (let i = 0; i < triCount; i++) {
      const idx = i * 3
      trianglesXml += `          <triangle v1="${idx}" v2="${idx + 1}" v3="${idx + 2}" pid="1" p1="${p1}"/>\n`
    }

    objectsXml += `    <object id="${currentId}" type="model">
      <mesh>
        <vertices>
${verticesXml}        </vertices>
        <triangles>
${trianglesXml}        </triangles>
      </mesh>
    </object>\n`
  }

  // Parent assembly object (ID 1)
  const parentObjectXml = `    <object id="1" type="model">
      <components>
${componentsXml}      </components>
    </object>\n`

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
    <basematerials id="1">
      <base name="Extruder A" displaycolor="#3b82f6"/>
      <base name="Extruder B" displaycolor="#ffffff"/>
    </basematerials>
${objectsXml}${parentObjectXml}  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`

  const encoder = new TextEncoder()
  const zip = zipSync({
    '[Content_Types].xml': encoder.encode(contentTypesXml),
    '_rels/.rels': encoder.encode(relsXml),
    '3D/3dmodel.model': encoder.encode(modelXml),
  })

  return zip
}
