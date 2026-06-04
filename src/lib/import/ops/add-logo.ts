import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { geom3ToBaseMesh, recomputeMeshDerived } from './_shared'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'

type AddLogoParams = Extract<Op, { op: 'add_logo' }>

/**
 * Apply a logo to a face of an (arbitrarily heavy) imported mesh.
 *
 * Two scale-free paths, picked by treatment so neither hits JSCAD's BSP limit:
 *   - **embossed** (raised): the extruded logo is appended as a SEPARATE
 *     extruder-B body sitting on the surface (sunk slightly so the slicer fuses
 *     it). No boolean → works on 700k+ triangle meshes.
 *   - **engraved / through_cut** (recessed/pierced): a volumetric subtract via
 *     Manifold (handles millions of triangles where JSCAD OOMs). Requires the
 *     base to be a watertight solid — throws otherwise (surfaced as a warning).
 */
export async function applyAddLogo(
  mesh: BaseMesh,
  op: AddLogoParams,
  faces: SemanticFace[],
  logoImageBuffer?: Buffer | null,
): Promise<BaseMesh> {
  // Placement frame: an explicit anchor (click-to-place) wins over a semantic
  // face (LLM path). The anchor lets the logo land exactly where the user
  // clicked, which semantic faces (grouped by normal only) can't pin down.
  let placeCentroid: [number, number, number]
  let placeNormal: [number, number, number]
  if (op.anchorPoint && op.anchorNormal) {
    placeCentroid = op.anchorPoint
    const [nx, ny, nz] = op.anchorNormal
    const len = Math.hypot(nx, ny, nz) || 1
    placeNormal = [nx / len, ny / len, nz / len]
  } else {
    const face = op.faceId != null ? faces[op.faceId] : undefined
    if (!face) throw new Error(`face ${op.faceId} out of range (have ${faces.length})`)
    placeCentroid = face.centroid
    placeNormal = face.normal
  }

  // The server already resolved the uploaded logo into a buffer — trust that
  // over op.imageUrl, which the LLM routinely hallucinates (e.g. "company_logo").
  // Fall back to the op URL/path only when no buffer was supplied (unit tests).
  let imgBuffer: Buffer
  if (logoImageBuffer) {
    imgBuffer = logoImageBuffer
  } else if (op.imageUrl.startsWith('http://') || op.imageUrl.startsWith('https://')) {
    const res = await fetch(op.imageUrl)
    if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
    imgBuffer = Buffer.from(await res.arrayBuffer())
  } else {
    const rel = op.imageUrl.startsWith('/') ? op.imageUrl.slice(1) : op.imageUrl
    imgBuffer = await readFile(join(process.cwd(), 'public', rel))
  }

  const isThrough = op.treatment === 'through_cut'

  // through_cut must pierce the whole local thickness; size the cutter to the
  // mesh's largest dimension so the silhouette punches clear through. Engrave /
  // emboss use the requested depth.
  const cutterDepth = isThrough ? Math.max(...mesh.bbox.size) * 1.2 : op.depthMm

  // Extrude the logo using the existing pipeline.
  // extrudeLogo returns a geom3 in "standing" orientation:
  //   - logo faces +Z, depth along Y, centered at origin
  //   - scaled so largest XZ dim = targetMaxDim, Y depth = depthMm
  const logoResult = await extrudeLogo({
    imageBuffer: imgBuffer,
    targetMaxDim: op.sizeMm,
    depthMm: cutterDepth,
    // Provide sensible defaults for the rest.
    binaryThreshold: 128,
    turdSize: 4,
    addBridges: false,
    texture: 'none',
  })

  if (!logoResult.geom3) {
    throw new Error('extrudeLogo returned no geom3 — image may have no traceable content')
  }

  // Resolve @jscad/modeling regardless of CJS-vs-ESM default-export shape
  // (mirrors loadJscad in _shared.ts — bare destructure breaks under tsx/node).
  const jscadNs = await import('@jscad/modeling')
  const { transforms } =
    (jscadNs as unknown as { default?: typeof import('@jscad/modeling') }).default ?? jscadNs

  // Lay the logo flat: rotateX(-π/2) maps standing → flat.
  // After this, the logo lies on the XY plane:
  //   - face area in XY, depth (cutterDepth) along +Z
  //   - Z range: [-cutterDepth/2, +cutterDepth/2] (centered at origin)
  let flat = transforms.rotateX(-Math.PI / 2, logoResult.geom3 as never) as Geom3

  // Orient +Z to the placement normal (same logic as hole.ts orientAlongNormal).
  flat = orientAlongNormal(flat, placeNormal, transforms)

  // Compute tangent frame for in-plane offset.
  const { tangent, bitangent } = makeFrame(placeNormal)

  // Base world position: anchor/centroid + in-plane offset.
  const wx = placeCentroid[0] + op.offsetMm[0] * tangent[0] + op.offsetMm[1] * bitangent[0]
  const wy = placeCentroid[1] + op.offsetMm[0] * tangent[1] + op.offsetMm[1] * bitangent[1]
  const wz = placeCentroid[2] + op.offsetMm[0] * tangent[2] + op.offsetMm[1] * bitangent[2]

  // Shift along the face normal. The flat geom is centred at Z=0, so:
  //   - embossed: protrude outward, but sink the base `embed` mm below the
  //     surface so the separate body overlaps and the slicer fuses it.
  //   - through_cut: centre the deep cutter on the face → pierces both sides.
  //   - engraved: top flush with the surface (+small overcut for a clean break),
  //     body extends inward by depthMm.
  let normalShift: number
  if (op.treatment === 'embossed') {
    // Sink a thin overlap below the surface so the separate body fuses in the
    // slicer; keep the bulk of the logo proud of the face.
    const embed = Math.min(0.2, op.depthMm * 0.25)
    normalShift = op.depthMm / 2 - embed
  } else if (isThrough) {
    normalShift = 0
  } else {
    normalShift = -op.depthMm / 2 + 0.1
  }

  const tx = wx + placeNormal[0] * normalShift
  const ty = wy + placeNormal[1] * normalShift
  const tz = wz + placeNormal[2] * normalShift

  const placed = transforms.translate([tx, ty, tz], flat as never) as Geom3

  if (op.treatment === 'embossed') {
    // Additive: the logo becomes its own extruder-B body. generate.ts splits
    // distinct extruders into separate print bodies; the viewer colours B.
    const logoBody = await geom3ToBaseMesh(placed, 'B')
    return appendBody(mesh, logoBody)
  }

  // Engrave / through-cut: volumetric subtract on the FULL solid via Manifold.
  // Boolean output is single-material (the recess is the base colour) → all 'A'.
  const { booleanSoup } = await import('../manifold-csg')
  const toolPositions = (await geom3ToBaseMesh(placed)).positions
  const resultPositions = await booleanSoup(mesh.positions, toolPositions, 'subtract')
  const triangleCount = resultPositions.length / 9
  return recomputeMeshDerived({
    positions: resultPositions,
    extruders: new Array(triangleCount).fill('A'),
    triangleCount,
  })
}

/** Concatenate a second body's triangles onto the base, preserving per-triangle
 *  extruder labels, and recompute normals + bbox. */
function appendBody(base: BaseMesh, body: BaseMesh): BaseMesh {
  const positions = new Float32Array(base.positions.length + body.positions.length)
  positions.set(base.positions, 0)
  positions.set(body.positions, base.positions.length)
  return recomputeMeshDerived({
    positions,
    extruders: [...base.extruders, ...body.extruders],
    triangleCount: positions.length / 9,
  })
}

function makeFrame(normal: [number, number, number]) {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  const seed: [number, number, number] =
    ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1]
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2]
  const tx = seed[0] - dot * normal[0]
  const ty = seed[1] - dot * normal[1]
  const tz = seed[2] - dot * normal[2]
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  const tangent: [number, number, number] = [tx / tl, ty / tl, tz / tl]
  const bitangent: [number, number, number] = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ]
  return { tangent, bitangent }
}

type Transforms = typeof import('@jscad/modeling').transforms

function orientAlongNormal(
  geom: Geom3,
  normal: [number, number, number],
  transforms: Transforms,
): Geom3 {
  // Geometry is built with extrusion along Z=[0,0,1].
  // Compute rotation that maps Z to `normal`.
  const dot = Math.max(-1, Math.min(1, normal[2])) // Z · normal = nz

  // Z aligns: no rotation needed
  if (dot > 0.9999) return geom

  // Z anti-aligns: flip 180° around X
  if (dot < -0.9999) return transforms.rotateX(Math.PI, geom) as Geom3

  const angle = Math.acos(dot)

  // Rotation axis = Z × normal = [0,0,1] × [nx,ny,nz] = [-ny, nx, 0]
  const axisX = -normal[1]
  const axisY = normal[0]
  const alen = Math.sqrt(axisX * axisX + axisY * axisY) || 1
  const naxisX = axisX / alen
  const naxisY = axisY / alen

  if (Math.abs(naxisY) >= Math.abs(naxisX)) {
    return transforms.rotateY(angle * Math.sign(naxisY), geom) as Geom3
  } else {
    return transforms.rotateX(angle * Math.sign(naxisX), geom) as Geom3
  }
}
