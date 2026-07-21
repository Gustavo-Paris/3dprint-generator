import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { geom3ToBaseMesh, makeFrame, orientAlongNormal, recomputeMeshDerived } from './_shared'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'

type AddLogoParams = Extract<Op, { op: 'add_logo' }>

/**
 * Apply a logo to a face of an (arbitrarily heavy) imported mesh.
 *
 * Placement pipeline:
 *   1. Extrude the logo silhouette into a planar solid.
 *   2. Orient + translate onto the click/face anchor.
 *   3. **Drape** vertices onto the host surface (curved heads, cylinders, …)
 *      so the logo rides the mesh instead of floating as a flat coin.
 *   4. Treatment-specific finish via Manifold:
 *      - **embossed**: logo − mesh → proud extruder-B body
 *      - **engraved**: mesh − logo + (logo ∩ mesh) inlay B
 *      - **through_cut**: mesh − logo only
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

  // Cap depth to local plate thickness. Keychains are often ~1.5–2 mm — a
  // 1.4 mm emboss with deep embed used to nearly pierce (or poke through) and
  // leave paper-thin residual shells the slicer flags as garbage.
  const plateThickness = Math.min(...mesh.bbox.size)
  const maxSafeDepth = isThrough
    ? Math.max(...mesh.bbox.size) * 1.2
    : Math.max(0.4, plateThickness * 0.45)
  const depthMm = isThrough ? maxSafeDepth : Math.min(op.depthMm, maxSafeDepth)

  // through_cut must pierce the whole local thickness; size the cutter to the
  // mesh's largest dimension so the silhouette punches clear through. Engrave /
  // emboss use the (capped) depth.
  const cutterDepth = depthMm

  // Extrude the logo using the existing pipeline.
  // extrudeLogo returns a geom3 in "standing" orientation:
  //   - logo faces +Z, depth along Y, centered at origin
  //   - scaled so largest XZ dim = targetMaxDim, Y depth = depthMm
  const logoResult = await extrudeLogo({
    imageBuffer: imgBuffer,
    targetMaxDim: op.sizeMm,
    depthMm: cutterDepth,
    // Printable monogram: drop speckles, simplify curves a bit, fatten stems
    // so 0.4 mm nozzles don't leave sub-layer white-dot garbage in Bambu.
    turdSize: 6,
    optTolerance: 0.25,
    fattenPx: 2,
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
    // Embed ~35% of depth so multi-body logo overlaps the host solidly without
    // piercing thin plates. Slice path unions A∪B for single-material STL.
    const embed = Math.min(0.4, Math.max(0.2, depthMm * 0.35))
    normalShift = depthMm / 2 - embed
  } else if (isThrough) {
    normalShift = 0
  } else {
    normalShift = -depthMm / 2 + 0.05
  }

  const tx = wx + placeNormal[0] * normalShift
  const ty = wy + placeNormal[1] * normalShift
  const tz = wz + placeNormal[2] * normalShift

  const placed = transforms.translate([tx, ty, tz], flat as never) as Geom3
  const { booleanSoup } = await import('../manifold-csg')
  let toolBody = await geom3ToBaseMesh(placed, 'B')

  // Drape onto curved hosts only (forehead, cylinders…). Flat keychains /
  // plaques skip this — raycast jitter on dense planar meshes created
  // micro-spikes the slicer shows as white garbage.
  if (!isThrough) {
    const { drapeLogoPositions, filterTrianglesNear, isLocallyPlanar } = await import('./drape-logo')
    const radius = op.sizeMm * 0.75 + 4
    const localHost = filterTrianglesNear(mesh.positions, placeCentroid, radius)
    if (localHost.length >= 9 && !isLocallyPlanar(localHost, placeCentroid, placeNormal)) {
      const draped = drapeLogoPositions(
        toolBody.positions,
        localHost,
        placeCentroid,
        placeNormal,
        normalShift,
      )
      toolBody = recomputeMeshDerived({
        positions: draped,
        extruders: toolBody.extruders,
        triangleCount: draped.length / 9,
      })
    }
  }

  // Always carve the logo volume out of the host first. Without this, embossed
  // multi-colour stacks B on top of A's existing emboss → double walls that
  // Bambu paints as white spikes (even when each body is watertight alone).
  // Engrave / through-cut need the same carve for the pocket.
  const carved = await booleanSoup(mesh.positions, toolBody.positions, 'subtract')
  const carvedCount = carved.length / 9
  const carvedMesh = recomputeMeshDerived({
    positions: carved,
    extruders: new Array(carvedCount).fill('A') as Array<'A' | 'B'>,
    triangleCount: carvedCount,
  })

  if (op.treatment === 'embossed') {
    // Full logo solid (proud + embed) sits in the pocket we just carved — no
    // overlapping shells. Export is a single mesh object with per-tri colours.
    return appendBody(carvedMesh, toolBody)
  }

  // through_cut: silhouette cut clear through — no fill.
  if (isThrough) return carvedMesh

  // engraved: fill the pocket with colour-B inlay only (logo ∩ original host).
  const inlaySoup = await booleanSoup(toolBody.positions, mesh.positions, 'intersect')
  const inlayCount = inlaySoup.length / 9
  const inlay = recomputeMeshDerived({
    positions: inlaySoup,
    extruders: new Array(inlayCount).fill('B') as Array<'A' | 'B'>,
    triangleCount: inlayCount,
  })
  return appendBody(carvedMesh, inlay)
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

