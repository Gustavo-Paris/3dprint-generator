import { unzipSync } from 'fflate'

export interface MeshBodyData {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

/** Parse a .3mf (zip-of-xml). Handles both the simple layout
 *  (everything in `3D/3dmodel.model`) and the Bambu/Prusa/Orca layout
 *  that splits geometry into `3D/Objects/object_N.model` per object.
 *
 *  Extruder/filament per body is recovered from `Metadata/model_settings.config`
 *  (`<part id="N"><metadata key="extruder" value="1|2"/>`), which is what we now
 *  emit and what Bambu honours. For backward compatibility with meshes serialized
 *  before that change, it falls back to the legacy per-triangle `p1` attribute. */
export function parse3mf(zipData: Uint8Array): MeshBodyData[] {
  const files = unzipSync(zipData)

  // object id -> extruder, parsed from model_settings.config (new format).
  const extruderByObjectId = new Map<string, 'A' | 'B'>()
  const cfg = files['Metadata/model_settings.config']
  if (cfg) {
    parseModelSettings(new TextDecoder().decode(cfg), extruderByObjectId)
  }

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
    bodies.push(...parseModelXml(xml, extruderByObjectId))
  }
  return bodies
}

/** Populate `out` with object-id -> extruder from a model_settings.config XML.
 *  `<part id="2" ...><metadata key="extruder" value="2"/></part>` => id 2 -> 'B'. */
function parseModelSettings(xml: string, out: Map<string, 'A' | 'B'>): void {
  const partRegex = /<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/gi
  let match: RegExpExecArray | null
  while ((match = partRegex.exec(xml)) !== null) {
    const partId = match[1]
    const body = match[2]
    const ex = /key="extruder"\s+value="([^"]+)"/i.exec(body)
    if (ex) {
      out.set(partId, ex[1].trim() === '2' ? 'B' : 'A')
    }
  }
}

function parseModelXml(
  xml: string,
  extruderByObjectId: Map<string, 'A' | 'B'>,
): MeshBodyData[] {
  const objectRegex = /<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/gi
  const vertexRegex = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/gi
  // p1 is optional — only present in legacy multi-material 3MFs we used to emit.
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

    // Prefer model_settings when it assigns the whole object; otherwise split
    // by per-triangle p1 so a single multi-colour mesh reloads as A+B bodies.
    const configExtruder = extruderByObjectId.get(objId)

    // Bucket tris by colour index (p1). Default 0 = extruder A.
    const buckets: number[][] = [[], []]
    let sawExplicitP1 = false
    triangleRegex.lastIndex = 0
    let tMatch: RegExpExecArray | null
    while ((tMatch = triangleRegex.exec(bodyContent)) !== null) {
      const v1 = parseInt(tMatch[1], 10)
      const v2 = parseInt(tMatch[2], 10)
      const v3 = parseInt(tMatch[3], 10)
      const p1Attr = tMatch[4]
      if (p1Attr !== undefined) sawExplicitP1 = true
      const colorIdx = p1Attr === '1' ? 1 : 0
      const pt1 = vertices[v1]
      const pt2 = vertices[v2]
      const pt3 = vertices[v3]
      if (!pt1 || !pt2 || !pt3) continue
      const bucket = buckets[colorIdx]
      bucket.push(pt1[0], pt1[1], pt1[2], pt2[0], pt2[1], pt2[2], pt3[0], pt3[1], pt3[2])
    }

    const hasSplit = buckets[0].length > 0 && buckets[1].length > 0
    if (hasSplit) {
      // Single mesh with multi-colour triangles (current serialize3mf path) →
      // two bodies. Per-triangle p1 wins over model_settings object extruder.
      bodies.push({
        positions: new Float32Array(buckets[0]),
        extruder: 'A',
        label: `Body ${objId} A`,
      })
      bodies.push({
        positions: new Float32Array(buckets[1]),
        extruder: 'B',
        label: `Body ${objId} B`,
      })
    } else {
      // One extruder for the whole object (legacy assembly component or config).
      const all = buckets[0].length || buckets[1].length
        ? buckets[0].concat(buckets[1])
        : []
      if (all.length > 0) {
        // Explicit per-triangle p1 wins over model_settings even when a single
        // bucket is populated — serialize3mf always writes part extruder="1",
        // which would misread an all-B (fully accent-painted) mesh as A.
        let extruder: 'A' | 'B' = configExtruder ?? 'A'
        if ((sawExplicitP1 || !configExtruder) && buckets[1].length > 0 && buckets[0].length === 0) {
          extruder = 'B'
        }
        bodies.push({
          positions: new Float32Array(all),
          extruder,
          label: `Body ${objId}`,
        })
      }
    }
  }

  return bodies
}
