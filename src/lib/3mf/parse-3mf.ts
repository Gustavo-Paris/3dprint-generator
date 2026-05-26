import { unzipSync } from 'fflate'

export interface MeshBodyData {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

export function parse3mf(zipData: Uint8Array): MeshBodyData[] {
  const files = unzipSync(zipData)
  const modelBytes = files['3D/3dmodel.model']
  if (!modelBytes) throw new Error('Invalid 3MF: missing 3D/3dmodel.model')
  const xml = new TextDecoder().decode(modelBytes)

  const objectRegex = /<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/gi
  const vertexRegex = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/gi
  const triangleRegex = /<triangle\s+v1="([^"]+)"\s+v2="([^"]+)"\s+v3="([^"]+)"(?:\s+pid="[^"]+")?\s+p1="([^"]+)"/gi

  const bodies: MeshBodyData[] = []
  let match: RegExpExecArray | null

  while ((match = objectRegex.exec(xml)) !== null) {
    const objId = match[1]
    const bodyContent = match[2]
    if (objId === '1') continue // Skip the assembly parent object

    // Parse vertices
    const vertices: [number, number, number][] = []
    let vMatch: RegExpExecArray | null
    // Reset vertexRegex index because we are running it inside a new block
    vertexRegex.lastIndex = 0
    while ((vMatch = vertexRegex.exec(bodyContent)) !== null) {
      vertices.push([parseFloat(vMatch[1]), parseFloat(vMatch[2]), parseFloat(vMatch[3])])
    }

    // Parse triangles and group by extruder
    let extruder: 'A' | 'B' = 'A'
    const positionsList: number[] = []
    let tMatch: RegExpExecArray | null
    // Reset triangleRegex index
    triangleRegex.lastIndex = 0
    while ((tMatch = triangleRegex.exec(bodyContent)) !== null) {
      const v1 = parseInt(tMatch[1], 10)
      const v2 = parseInt(tMatch[2], 10)
      const v3 = parseInt(tMatch[3], 10)
      const p1Attr = tMatch[4]
      if (p1Attr === '1') extruder = 'B'

      const pt1 = vertices[v1]
      const pt2 = vertices[v2]
      const pt3 = vertices[v3]
      if (pt1 && pt2 && pt3) {
        positionsList.push(...pt1, ...pt2, ...pt3)
      }
    }

    if (positionsList.length > 0) {
      bodies.push({
        positions: new Float32Array(positionsList),
        extruder,
        label: `Body ${objId}`,
      })
    }
  }

  return bodies
}
