import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { baseMeshToGeom3, geom3ToBaseMesh, makeFrame, orientAlongNormal } from './_shared'
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'

type HoleParams = Extract<Op, { op: 'hole' }>

export async function applyHole(
  mesh: BaseMesh,
  op: HoleParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const face = faces[op.faceId]
  if (!face) throw new Error(`face ${op.faceId} out of range (have ${faces.length})`)

  const { primitives, booleans, transforms } = await import('@jscad/modeling')
  const base = await baseMeshToGeom3(mesh) as Geom3

  // Depth: 'through' = bbox diagonal * 2 to guarantee passage
  const diag = Math.sqrt(
    mesh.bbox.size[0] ** 2 + mesh.bbox.size[1] ** 2 + mesh.bbox.size[2] ** 2,
  )
  const depth = op.depthMm === 'through' ? diag * 2 : op.depthMm

  const cutters: Geom3[] = []
  for (const [u, v] of op.positions) {
    let cutter: Geom3
    if (op.shape === 'circle') {
      const r = (op.diameterMm ?? 3) / 2
      cutter = primitives.cylinder({ radius: r, height: depth })
    } else {
      const w = op.widthMm ?? 3
      const h = op.heightMm ?? 3
      cutter = primitives.cuboid({ size: [w, h, depth] })
    }

    // Orient cutter axis along face.normal.
    // JSCAD cylinder/cuboid are built along Z=[0,0,1] by default.
    cutter = orientAlongNormal(cutter, face.normal, transforms)

    // Place at face centroid + (u, v) in face's tangent frame.
    const { tangent, bitangent } = makeFrame(face.normal)
    const wx = face.centroid[0] + u * tangent[0] + v * bitangent[0]
    const wy = face.centroid[1] + u * tangent[1] + v * bitangent[1]
    const wz = face.centroid[2] + u * tangent[2] + v * bitangent[2]
    // For 'through', push the cutter back along -normal by depth/2 so it spans
    // the mesh symmetrically through the face.
    const cx = wx - face.normal[0] * (depth / 2 - 0.001)
    const cy = wy - face.normal[1] * (depth / 2 - 0.001)
    const cz = wz - face.normal[2] * (depth / 2 - 0.001)
    cutters.push(transforms.translate([cx, cy, cz], cutter) as Geom3)
  }

  const result = booleans.subtract(base, ...cutters)
  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}

