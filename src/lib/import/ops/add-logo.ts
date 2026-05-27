import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { baseMeshToGeom3, geom3ToBaseMesh } from './_shared'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'

type AddLogoParams = Extract<Op, { op: 'add_logo' }>

export async function applyAddLogo(
  mesh: BaseMesh,
  op: AddLogoParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const face = faces[op.faceId]
  if (!face) throw new Error(`face ${op.faceId} out of range (have ${faces.length})`)

  // Fetch the logo image. Accepts absolute URL (blob) or local path
  // (`/uploads/...` resolved against the Next `public/` dir in dev).
  let imgBuffer: Buffer
  if (op.imageUrl.startsWith('http://') || op.imageUrl.startsWith('https://')) {
    const res = await fetch(op.imageUrl)
    if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
    imgBuffer = Buffer.from(await res.arrayBuffer())
  } else {
    const rel = op.imageUrl.startsWith('/') ? op.imageUrl.slice(1) : op.imageUrl
    imgBuffer = await readFile(join(process.cwd(), 'public', rel))
  }

  // Extrude the logo using the existing pipeline.
  // extrudeLogo returns a geom3 in "standing" orientation:
  //   - logo faces +Z, depth along Y, centered at origin
  //   - scaled so largest XZ dim = targetMaxDim, Y depth = depthMm
  const logoResult = await extrudeLogo({
    imageBuffer: imgBuffer,
    targetMaxDim: op.sizeMm,
    depthMm: op.depthMm,
    // Provide sensible defaults for the rest.
    binaryThreshold: 128,
    turdSize: 4,
    addBridges: false,
    texture: 'none',
  })

  if (!logoResult.geom3) {
    throw new Error('extrudeLogo returned no geom3 — image may have no traceable content')
  }

  const { booleans, transforms } = await import('@jscad/modeling')

  // Lay the logo flat: rotateX(-π/2) maps standing → flat.
  // After this, the logo lies on the XY plane:
  //   - face area in XY, depth (op.depthMm) along +Z
  //   - Z range: [-depthMm/2, +depthMm/2] (centered at origin)
  let flat = transforms.rotateX(-Math.PI / 2, logoResult.geom3 as never) as Geom3

  // Orient +Z to face normal (same logic as hole.ts orientAlongNormal).
  flat = orientAlongNormal(flat, face.normal, transforms)

  // Compute tangent frame for in-plane offset.
  const { tangent, bitangent } = makeFrame(face.normal)

  // Base world position: face centroid + in-plane offset.
  const wx = face.centroid[0] + op.offsetMm[0] * tangent[0] + op.offsetMm[1] * bitangent[0]
  const wy = face.centroid[1] + op.offsetMm[0] * tangent[1] + op.offsetMm[1] * bitangent[1]
  const wz = face.centroid[2] + op.offsetMm[0] * tangent[2] + op.offsetMm[1] * bitangent[2]

  // Shift along face normal so the logo sits on (embossed) or inside (engraved) the surface.
  // The flat geom center is at origin (Z=0), so:
  //   - embossed: push by +depthMm/2 so the base is at the face surface
  //   - engraved/through_cut: push by -depthMm/2 so the top is at the face surface (cuts inward)
  const normalShift = op.treatment === 'embossed' ? op.depthMm / 2 : -op.depthMm / 2

  const tx = wx + face.normal[0] * normalShift
  const ty = wy + face.normal[1] * normalShift
  const tz = wz + face.normal[2] * normalShift

  const placed = transforms.translate([tx, ty, tz], flat as never) as Geom3

  const base = await baseMeshToGeom3(mesh) as Geom3
  const result =
    op.treatment === 'engraved' || op.treatment === 'through_cut'
      ? booleans.subtract(base, placed)
      : booleans.union(base, placed)

  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
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
