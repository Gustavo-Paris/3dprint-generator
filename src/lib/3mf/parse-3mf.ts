import { unzipSync } from 'fflate'

export interface MeshBodyData {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

/** 3MF affine transform: 12 numbers, row-major 4x3
 *  (m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32), row-vector convention —
 *  translation in the last three values. */
type Transform3mf = number[]

interface Component {
  objectid: string
  /** `p:path` production-extension ref — id namespace of another .model file. */
  path?: string
  transform?: Transform3mf
}

interface ParsedObject {
  id: string
  fileKey: string
  name?: string
  /** Object-level basematerials color index (`pid`/`pindex` attrs) — what cadpy
   *  emits for single-material bodies inside a multi-material assembly. */
  pindex?: number
  meshContent?: string
  components?: Component[]
}

const MAX_COMPONENT_DEPTH = 64

/** Parse a .3mf (zip-of-xml). Handles the simple layout (everything in
 *  `3D/3dmodel.model`), the Bambu/Prusa/Orca layout that splits geometry into
 *  `3D/Objects/object_N.model` per object, and `<components>` composition with
 *  transforms (assemblies — e.g. cadpy/text-to-cad exports), resolving `p:path`
 *  refs in the referenced file's id namespace.
 *
 *  Build-item transforms are intentionally dropped: they are plate placement,
 *  not model geometry. Component transforms are applied (mirroring transforms
 *  flip triangle winding so normals stay outward).
 *
 *  Extruder/filament per body is recovered from `Metadata/model_settings.config`
 *  (`<part id="N"><metadata key="extruder" value="1|2"/>`), which is what we now
 *  emit and what Bambu honours. Fallbacks, in order: legacy per-triangle `p1`
 *  attribute, then the object-level `pindex` (cadpy assemblies). */
export function parse3mf(zipData: Uint8Array): MeshBodyData[] {
  const files = unzipSync(zipData)

  // object id -> extruder, parsed from model_settings.config (new format).
  const extruderByObjectId = new Map<string, 'A' | 'B'>()
  const cfg = files['Metadata/model_settings.config']
  if (cfg) {
    parseModelSettings(new TextDecoder().decode(cfg), extruderByObjectId)
  }

  // Collect every `.model` file under `3D/` — that's where geometry lives.
  const modelFiles = new Map<string, string>()
  if (files['3D/3dmodel.model']) {
    modelFiles.set('3D/3dmodel.model', new TextDecoder().decode(files['3D/3dmodel.model']))
  }
  for (const name of Object.keys(files)) {
    if (name.startsWith('3D/Objects/') && name.endsWith('.model')) {
      modelFiles.set(name, new TextDecoder().decode(files[name]))
    }
  }
  if (modelFiles.size === 0) {
    throw new Error('Invalid 3MF: no .model files under 3D/')
  }

  // Registry: fileKey -> (object id -> object). Ids are per-file namespaces
  // (the Bambu split layout reuses ids across Objects/*.model files).
  const registry = new Map<string, Map<string, ParsedObject>>()
  const buildRoots: { fileKey: string; objectid: string; path?: string }[] = []
  for (const [fileKey, xml] of modelFiles) {
    const objects = new Map<string, ParsedObject>()
    for (const obj of parseObjects(xml, fileKey)) {
      objects.set(obj.id, obj)
    }
    registry.set(fileKey, objects)
    for (const item of parseBuildItems(xml)) {
      buildRoots.push({ fileKey, ...item })
    }
  }

  // Traversal roots: build items when present (3MF spec — only build items are
  // printed), otherwise every object of every file (legacy tolerance).
  const bodies: MeshBodyData[] = []
  const emit = (obj: ParsedObject, transform: Transform3mf | null) =>
    emitBodies(obj, transform, extruderByObjectId, bodies)

  const resolve = (
    fileKey: string,
    objectid: string,
    transform: Transform3mf | null,
    stack: Set<string>,
  ): void => {
    const key = `${fileKey}#${objectid}`
    if (stack.has(key)) {
      throw new Error(`Invalid 3MF: component reference cycle at ${key}`)
    }
    if (stack.size >= MAX_COMPONENT_DEPTH) {
      throw new Error('Invalid 3MF: component nesting too deep')
    }
    const obj = registry.get(fileKey)?.get(objectid)
    if (!obj) return // dangling ref — skip, keep the rest of the build
    if (obj.components) {
      stack.add(key)
      for (const c of obj.components) {
        const childFile = c.path ?? fileKey
        resolve(childFile, c.objectid, composeTransforms(c.transform ?? null, transform), stack)
      }
      stack.delete(key)
      return
    }
    emit(obj, transform)
  }

  if (buildRoots.length > 0) {
    for (const root of buildRoots) {
      // Build-item transform intentionally ignored (plate placement).
      resolve(root.path ?? root.fileKey, root.objectid, null, new Set())
    }
  } else {
    for (const objects of registry.values()) {
      for (const obj of objects.values()) {
        if (!obj.components) emit(obj, null)
      }
    }
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

function parseObjects(xml: string, fileKey: string): ParsedObject[] {
  const objectRegex = /<object\s+([^>]*)>([\s\S]*?)<\/object>/gi
  const objects: ParsedObject[] = []
  let match: RegExpExecArray | null
  while ((match = objectRegex.exec(xml)) !== null) {
    const attrs = match[1]
    const content = match[2]
    const id = attrValue(attrs, 'id')
    if (!id) continue
    const obj: ParsedObject = { id, fileKey }
    const name = attrValue(attrs, 'name')
    if (name) obj.name = name
    const pindex = attrValue(attrs, 'pindex')
    if (pindex !== undefined && attrValue(attrs, 'pid') !== undefined) {
      const n = parseInt(pindex, 10)
      if (Number.isFinite(n)) obj.pindex = n
    }
    if (/<components[\s>]/i.test(content)) {
      obj.components = parseComponents(content)
    } else {
      obj.meshContent = content
    }
    objects.push(obj)
  }
  return objects
}

function parseComponents(content: string): Component[] {
  const componentRegex = /<component\s+([^>]*?)\/?>/gi
  const components: Component[] = []
  let match: RegExpExecArray | null
  while ((match = componentRegex.exec(content)) !== null) {
    const attrs = match[1]
    const objectid = attrValue(attrs, 'objectid')
    if (!objectid) continue
    const component: Component = { objectid }
    const path = attrValue(attrs, 'p:path')
    if (path) component.path = path.replace(/^\//, '')
    const transform = parseTransform(attrValue(attrs, 'transform'))
    if (transform) component.transform = transform
    components.push(component)
  }
  return components
}

function parseBuildItems(xml: string): { objectid: string; path?: string }[] {
  const buildMatch = /<build[^>]*>([\s\S]*?)<\/build>/i.exec(xml)
  if (!buildMatch) return []
  const itemRegex = /<item\s+([^>]*?)\/?>/gi
  const items: { objectid: string; path?: string }[] = []
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(buildMatch[1])) !== null) {
    const objectid = attrValue(match[1], 'objectid')
    if (!objectid) continue
    const path = attrValue(match[1], 'p:path')
    items.push(path ? { objectid, path: path.replace(/^\//, '') } : { objectid })
  }
  return items
}

function attrValue(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`, 'i').exec(attrs)
  return m ? m[1] : undefined
}

function parseTransform(value: string | undefined): Transform3mf | null {
  if (!value) return null
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return null
  return isIdentity(parts) ? null : parts
}

function isIdentity(m: Transform3mf): boolean {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
  return m.every((v, i) => Math.abs(v - identity[i]) < 1e-12)
}

/** Compose row-vector transforms: `first` applied to the point, then `second`. */
function composeTransforms(
  first: Transform3mf | null,
  second: Transform3mf | null,
): Transform3mf | null {
  if (!first) return second
  if (!second) return first
  const out: number[] = new Array(12).fill(0)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += first[i * 3 + k] * second[k * 3 + j]
      out[i * 3 + j] = sum
    }
  }
  for (let j = 0; j < 3; j++) {
    let sum = second[9 + j]
    for (let k = 0; k < 3; k++) sum += first[9 + k] * second[k * 3 + j]
    out[9 + j] = sum
  }
  return out
}

function applyTransform(m: Transform3mf, p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ]
}

/** Determinant of the rotation part — negative means the transform mirrors,
 *  which flips triangle winding. */
function rotationDeterminant(m: Transform3mf): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

function emitBodies(
  obj: ParsedObject,
  transform: Transform3mf | null,
  extruderByObjectId: Map<string, 'A' | 'B'>,
  out: MeshBodyData[],
): void {
  const bodyContent = obj.meshContent
  if (!bodyContent) return
  const objId = obj.id
  const baseLabel = obj.name ?? `Body ${objId}`

  const vertexRegex = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/gi
  // p1 is optional — only present in legacy multi-material 3MFs we used to emit.
  const triangleRegex = /<triangle\s+v1="([^"]+)"\s+v2="([^"]+)"\s+v3="([^"]+)"(?:[^>]*?\sp1="([^"]+)")?[^>]*?\/?>/gi

  // Parse vertices (transformed once, up front).
  const vertices: [number, number, number][] = []
  let vMatch: RegExpExecArray | null
  while ((vMatch = vertexRegex.exec(bodyContent)) !== null) {
    const p: [number, number, number] = [
      parseFloat(vMatch[1]),
      parseFloat(vMatch[2]),
      parseFloat(vMatch[3]),
    ]
    vertices.push(transform ? applyTransform(transform, p) : p)
  }
  const flipWinding = transform !== null && rotationDeterminant(transform) < 0

  // Prefer model_settings when it assigns the whole object; otherwise split
  // by per-triangle p1 so a single multi-colour mesh reloads as A+B bodies.
  const configExtruder = extruderByObjectId.get(objId)

  // Bucket tris by colour index (p1). Default 0 = extruder A.
  const buckets: number[][] = [[], []]
  let sawExplicitP1 = false
  let tMatch: RegExpExecArray | null
  while ((tMatch = triangleRegex.exec(bodyContent)) !== null) {
    const v1 = parseInt(tMatch[1], 10)
    const v2 = parseInt(tMatch[2], 10)
    const v3 = parseInt(tMatch[3], 10)
    const p1Attr = tMatch[4]
    if (p1Attr !== undefined) sawExplicitP1 = true
    const colorIdx = p1Attr === '1' ? 1 : 0
    const pt1 = vertices[v1]
    const pt2 = flipWinding ? vertices[v3] : vertices[v2]
    const pt3 = flipWinding ? vertices[v2] : vertices[v3]
    if (!pt1 || !pt2 || !pt3) continue
    const bucket = buckets[colorIdx]
    bucket.push(pt1[0], pt1[1], pt1[2], pt2[0], pt2[1], pt2[2], pt3[0], pt3[1], pt3[2])
  }

  const hasSplit = buckets[0].length > 0 && buckets[1].length > 0
  if (hasSplit) {
    // Single mesh with multi-colour triangles (current serialize3mf path) →
    // two bodies. Per-triangle p1 wins over model_settings object extruder.
    out.push({
      positions: new Float32Array(buckets[0]),
      extruder: 'A',
      label: `${baseLabel} A`,
    })
    out.push({
      positions: new Float32Array(buckets[1]),
      extruder: 'B',
      label: `${baseLabel} B`,
    })
  } else {
    // One extruder for the whole object (assembly component or config).
    const all = buckets[0].length || buckets[1].length
      ? buckets[0].concat(buckets[1])
      : []
    if (all.length > 0) {
      // Explicit per-triangle p1 wins over model_settings even when a single
      // bucket is populated — serialize3mf always writes part extruder="1",
      // which would misread an all-B (fully accent-painted) mesh as A.
      // Object-level pindex (cadpy assemblies) is the last fallback before A.
      const pindexExtruder: 'A' | 'B' | undefined =
        obj.pindex === undefined ? undefined : obj.pindex >= 1 ? 'B' : 'A'
      let extruder: 'A' | 'B' = configExtruder ?? pindexExtruder ?? 'A'
      if ((sawExplicitP1 || !configExtruder) && buckets[1].length > 0 && buckets[0].length === 0) {
        extruder = 'B'
      }
      out.push({
        positions: new Float32Array(all),
        extruder,
        label: baseLabel,
      })
    }
  }
}
