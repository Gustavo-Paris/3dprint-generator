import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { geom3ToBaseMesh, makeFrame, recomputeMeshDerived } from './_shared'
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
  warn?: (reason: string) => void,
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

  // Measure free room around the click (asymmetric). Symmetric min-span alone
  // left logos hanging off pedestal bottoms when the user clicked low
  // (prod, 2026-08-05 5G-on-funko). Room drives both scale AND a shift of the
  // anchor toward the roomier side of the face.
  const {
    measureLocalFaceRoom,
    fitLogoIntoRoom,
    filterTrianglesNear: filterNearForFit,
    shouldDrapeLogo,
  } = await import('./drape-logo')
  type Room = import('./drape-logo').LocalFaceRoom
  let faceRoom: Room | null = null
  const fitRadius = Math.max(op.sizeMm, 24) / 2 + 10
  const fitHost = filterNearForFit(mesh.positions, placeCentroid, fitRadius)
  if (fitHost.length >= 9) {
    faceRoom = measureLocalFaceRoom(fitHost, placeCentroid, placeNormal, Math.max(op.sizeMm, 24) / 2)
    // Small faces need a finer second pass — the first one marched with
    // steps sized for the REQUESTED logo, too coarse for a tiny pedestal.
    if (Math.max(faceRoom.uSpan, faceRoom.vSpan) < 15) {
      faceRoom = measureLocalFaceRoom(
        fitHost,
        placeCentroid,
        placeNormal,
        Math.max(Math.max(faceRoom.uSpan, faceRoom.vSpan) * 0.75, 3),
      )
    }
  }

  // Cap depth. Keychains are thin plates (min bbox ≈ thickness). Figurines are
  // bulky — min bbox is the XY width, so the old 0.45×min rule allowed absurd
  // depths. For bulky meshes, hard-cap emboss/engrave so the tool doesn't
  // pierce the pedestal shell and leave a flat green slab through the base.
  const minDim = Math.min(...mesh.bbox.size)
  const maxDim = Math.max(...mesh.bbox.size)
  const isBulky = maxDim / Math.max(minDim, 1e-6) < 5 && minDim > 8
  const maxSafeDepth = isThrough
    ? maxDim * 1.2
    : isBulky
      ? Math.min(1.2, op.depthMm)
      : Math.max(0.4, minDim * 0.45)
  const depthMm = isThrough ? maxSafeDepth : Math.min(op.depthMm, maxSafeDepth)

  // through_cut must pierce the whole local thickness; size the cutter to the
  // mesh's largest dimension so the silhouette punches clear through. Engrave /
  // emboss use the (capped) depth.
  const cutterDepth = depthMm

  // Pre-clamp request size to free room so potrace/extrude work at printable
  // resolution for the final footprint (not a 45 mm logo later crushed to 12).
  let requestSizeMm = op.sizeMm
  if (faceRoom) {
    const roomCap = Math.max(faceRoom.uSpan, faceRoom.vSpan) * 0.92
    if (roomCap > 1) requestSizeMm = Math.min(requestSizeMm, roomCap)
  }

  // Extrude the logo using the existing pipeline.
  // extrudeLogo returns a geom3 in "standing" orientation:
  //   - logo faces +Z, depth along Y, centered at origin
  //   - scaled so largest XZ dim = targetMaxDim, Y depth = depthMm
  const logoResult = await extrudeLogo({
    imageBuffer: imgBuffer,
    targetMaxDim: requestSizeMm,
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

  // Fit into free room: scale + in-plane shift so a low click on a pedestal
  // doesn't leave half the monogram hanging under the base.
  let standing = logoResult.geom3 as Geom3
  let effectiveSizeMm = requestSizeMm
  let shiftU = 0
  let shiftV = 0
  if (faceRoom) {
    const logoW = logoResult.meta.bboxMm.x || 1
    const logoH = logoResult.meta.bboxMm.z || 1
    const fit = fitLogoIntoRoom(logoW, logoH, faceRoom)
    // NEVER force a floor above what the face fits (the old 12 mm floor made
    // logos larger than small-figurine pedestals → boolean shrapnel). A logo
    // under ~6 mm is unprintable noise with a 0.4 nozzle — skip with a clear
    // message instead of producing garbage.
    if (Math.max(fit.finalW, fit.finalH) < 6) {
      throw new Error(
        `a face clicada só comporta ~${Math.max(1, Math.round(Math.max(fit.finalW, fit.finalH)))}mm de logo — ` +
          'muito pequeno para imprimir. Clique no meio da face (ex.: peito ou centro do pedestal) ' +
          'ou aumente o modelo antes de aplicar o logo.',
      )
    }
    if (fit.fitFactor < 0.98) {
      standing = transforms.scale([fit.fitFactor, 1, fit.fitFactor], standing as never) as Geom3
      warn?.(
        `logo ajustado para ${Math.round(fit.finalW)}×${Math.round(fit.finalH)}mm ` +
          'para caber na face clicada',
      )
    }
    if (Math.abs(fit.shiftU) > 0.3 || Math.abs(fit.shiftV) > 0.3) {
      warn?.(
        `logo recentrado +${Math.round(fit.shiftU)}mm / +${Math.round(fit.shiftV)}mm ` +
          'para não sair da face',
      )
    }
    shiftU = fit.shiftU
    shiftV = fit.shiftV
    effectiveSizeMm = Math.max(fit.finalW, fit.finalH)
  }

  // Lay the logo flat: rotateX(-π/2) maps standing → flat.
  // After this, the logo lies on the XY plane:
  //   - face area in XY, depth (cutterDepth) along +Z
  //   - local +Y is the TEXT'S UP, local +X its reading direction
  let flat = transforms.rotateX(-Math.PI / 2, standing as never) as Geom3

  // Orient with an EXPLICIT upright basis, not the minimal +Z→normal
  // rotation: the minimal rotation leaves the in-plane roll arbitrary, which
  // happened to be upright on front (−Y) faces but tilted/laid the text on
  // side and diagonal faces (prod, 2026-08-02). Columns: X→t (reading
  // direction), Y→u (up = world +Z projected onto the face; −Y for top /
  // bottom faces so text reads from the front), Z→n.
  {
    const n = placeNormal
    const upRef: [number, number, number] =
      Math.abs(n[2]) < 0.99 ? [0, 0, 1] : [0, -1, 0]
    let tX = upRef[1] * n[2] - upRef[2] * n[1]
    let tY = upRef[2] * n[0] - upRef[0] * n[2]
    let tZ = upRef[0] * n[1] - upRef[1] * n[0]
    const tLen = Math.hypot(tX, tY, tZ) || 1
    tX /= tLen; tY /= tLen; tZ /= tLen
    const uX = n[1] * tZ - n[2] * tY
    const uY = n[2] * tX - n[0] * tZ
    const uZ = n[0] * tY - n[1] * tX
    flat = transforms.transform(
      [tX, tY, tZ, 0, uX, uY, uZ, 0, n[0], n[1], n[2], 0, 0, 0, 0, 1],
      flat as never,
    ) as Geom3
  }

  // Prefer the room's tangent frame (matches the march axes) so shiftU/V
  // land on the same basis; fall back to makeFrame for faces with no room.
  const tangent = faceRoom?.tangent ?? makeFrame(placeNormal).tangent
  const bitangent = faceRoom?.bitangent ?? makeFrame(placeNormal).bitangent

  // Base world position: anchor + LLM offset + room re-center shift.
  const ou = op.offsetMm[0] + shiftU
  const ov = op.offsetMm[1] + shiftV
  const wx = placeCentroid[0] + ou * tangent[0] + ov * bitangent[0]
  const wy = placeCentroid[1] + ou * tangent[1] + ov * bitangent[1]
  const wz = placeCentroid[2] + ou * tangent[2] + ov * bitangent[2]

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

  // Drape onto curved hosts / vertical walls (forehead, cylinders, pedestals).
  // Flat keychains / plaques skip this — raycast jitter on dense planar
  // meshes created micro-spikes the slicer shows as white garbage.
  // Drape around the SHIFTED center (wx,wy,wz projected back isn't needed —
  // use the shifted surface point on the normal ray).
  if (!isThrough) {
    const { drapeLogoPositions, filterTrianglesNear, subdivideSoupToMaxEdge } =
      await import('./drape-logo')
    const radius = effectiveSizeMm * 0.85 + 6
    // Surface anchor after in-plane shift (still on the face plane ≈).
    const drapeCenter: [number, number, number] = [
      placeCentroid[0] + ou * tangent[0] + ov * bitangent[0],
      placeCentroid[1] + ou * tangent[1] + ov * bitangent[1],
      placeCentroid[2] + ou * tangent[2] + ov * bitangent[2],
    ]
    const localHost = filterTrianglesNear(mesh.positions, drapeCenter, radius)
    if (localHost.length >= 9 && shouldDrapeLogo(localHost, drapeCenter, placeNormal)) {
      // Finer subdivision on tight cylinders so the monogram bends cleanly.
      const maxEdge = Math.min(0.9, effectiveSizeMm / 18)
      const refined = subdivideSoupToMaxEdge(toolBody.positions, maxEdge)
      const draped = drapeLogoPositions(
        refined,
        localHost,
        drapeCenter,
        placeNormal,
        normalShift,
      )
      toolBody = recomputeMeshDerived({
        positions: draped,
        extruders: new Array(draped.length / 9).fill('B') as Array<'A' | 'B'>,
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

