import { unzipSync } from 'fflate'

export interface MeshBodyData {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

/** Parse a .3mf (zip-of-xml). Handles both the simple layout
 *  (everything in `3D/3dmodel.model`) and the Bambu/Prusa/Orca layout
 *  that splits geometry into `3D/Objects/object_N.model` per object. */
export function parse3mf(zipData: Uint8Array): MeshBodyData[] {
  const files = unzipSync(zipData)

  // Collect every `.model` file under `3D/` — that's where geometry lives.
  const modelXmls: string[] = []
  if (files['3D/3dmodel.model']) {
    modelXmls.push(new TextDecoder().decode(files['3D/3dmodel.model']))
  }
  for (const name of Object.keys(files)) {
    if (name.startsWith('3D/Objects/') && name.endsWith('.model')) {
      modelXmls.push(new TextDecoder().decode(files[name]))
    }
  }
  if (modelXmls.length === 0) {
    throw new Error('Invalid 3MF: no .model files under 3D/')
  }

  const bodies: MeshBodyData[] = []
  for (const xml of modelXmls) {
    bodies.push(...parseModelXml(xml))
  }
  return bodies
}

function parseModelXml(xml: string): MeshBodyData[] {
  const objectRegex = /<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/gi
  const vertexRegex = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/gi
  // p1 is optional (only present in multi-material 3MFs from BambuStudio etc.)
  const triangleRegex = /<triangle\s+v1="([^"]+)"\s+v2="([^"]+)"\s+v3="([^"]+)"(?:[^>]*?\sp1="([^"]+)")?[^>]*?\/?>/gi

  const bodies: MeshBodyData[] = []
  let match: RegExpExecArray | null

  while ((match = objectRegex.exec(xml)) !== null) {
    const objId = match[1]
    const bodyContent = match[2]

    // Parse vertices
    const vertices: [number, number, number][] = []
    let vMatch: RegExpExecArray | null
    vertexRegex.lastIndex = 0
    while ((vMatch = vertexRegex.exec(bodyContent)) !== null) {
      vertices.push([parseFloat(vMatch[1]), parseFloat(vMatch[2]), parseFloat(vMatch[3])])
    }

    // Parse triangles and infer extruder when p1 is present.
    // Two-pass: count valid triangles first so we can allocate the exact
    // Float32Array up front and write by index (no growing number[] + no
    // per-triangle spread).
    let extruder: 'A' | 'B' = 'A'

    // Pass 1: count valid triangles (all three verts resolvable).
    let triCount = 0
    triangleRegex.lastIndex = 0
    let cMatch: RegExpExecArray | null
    while ((cMatch = triangleRegex.exec(bodyContent)) !== null) {
      const a = parseInt(cMatch[1], 10)
      const b = parseInt(cMatch[2], 10)
      const c = parseInt(cMatch[3], 10)
      if (vertices[a] && vertices[b] && vertices[c]) triCount++
    }

    // Pass 2: fill the preallocated buffer (9 floats per triangle).
    const positions = new Float32Array(triCount * 9)
    let w = 0
    triangleRegex.lastIndex = 0
    let tMatch: RegExpExecArray | null
    while ((tMatch = triangleRegex.exec(bodyContent)) !== null) {
      const v1 = parseInt(tMatch[1], 10)
      const v2 = parseInt(tMatch[2], 10)
      const v3 = parseInt(tMatch[3], 10)
      const p1Attr = tMatch[4]  // may be undefined when p1 isn't present
      if (p1Attr === '1') extruder = 'B'

      const pt1 = vertices[v1]
      const pt2 = vertices[v2]
      const pt3 = vertices[v3]
      if (pt1 && pt2 && pt3) {
        positions[w++] = pt1[0]; positions[w++] = pt1[1]; positions[w++] = pt1[2]
        positions[w++] = pt2[0]; positions[w++] = pt2[1]; positions[w++] = pt2[2]
        positions[w++] = pt3[0]; positions[w++] = pt3[1]; positions[w++] = pt3[2]
      }
    }

    if (positions.length > 0) {
      bodies.push({
        positions,
        extruder,
        label: `Body ${objId}`,
      })
    }
  }

  return bodies
}
