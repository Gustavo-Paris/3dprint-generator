/**
 * paint_region — assign triangles on an imported mesh to extruder A or B.
 * Geometry (positions/normals) is unchanged; only the multi-material labels flip.
 * Downstream generateFromDesign splits by extruder → multi-body 3MF.
 */
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'

type PaintParams = Extract<Op, { op: 'paint_region' }>

/** Dominant face direction from unit normal (same convention as parse-import). */
export function faceDirection(normal: readonly [number, number, number]): string {
  const [x, y, z] = normal
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z)
  if (az >= ax && az >= ay) return z > 0 ? 'TOP' : 'BOTTOM'
  if (ay >= ax) return y > 0 ? 'BACK' : 'FRONT'
  return x > 0 ? 'RIGHT' : 'LEFT'
}

function triangleCentroidZ(positions: Float32Array, tri: number): number {
  const o = tri * 9
  return (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3
}

function selectTriangles(
  mesh: BaseMesh,
  faces: SemanticFace[],
  op: PaintParams,
): number[] {
  if (op.faceIds && op.faceIds.length > 0) {
    const out = new Set<number>()
    for (const id of op.faceIds) {
      const face = faces.find((f) => f.id === id)
      if (!face) continue
      for (const t of face.triangleIndices) out.add(t)
    }
    return Array.from(out)
  }

  if (op.zFraction) {
    const minF = Math.min(op.zFraction.min, op.zFraction.max)
    const maxF = Math.max(op.zFraction.min, op.zFraction.max)
    const z0 = mesh.bbox.min[2]
    const h = mesh.bbox.size[2] || 1
    const lo = z0 + minF * h
    const hi = z0 + maxF * h
    const out: number[] = []
    for (let i = 0; i < mesh.triangleCount; i++) {
      const z = triangleCentroidZ(mesh.positions, i)
      if (z >= lo - 1e-6 && z <= hi + 1e-6) out.push(i)
    }
    return out
  }

  if (op.region) {
    switch (op.region) {
      case 'all':
        return Array.from({ length: mesh.triangleCount }, (_, i) => i)
      case 'upper_half':
        return selectTriangles(mesh, faces, {
          op: 'paint_region',
          extruder: op.extruder,
          zFraction: { min: 0.5, max: 1 },
        })
      case 'lower_half':
        return selectTriangles(mesh, faces, {
          op: 'paint_region',
          extruder: op.extruder,
          zFraction: { min: 0, max: 0.5 },
        })
      case 'top_faces':
      case 'bottom_faces':
      case 'front_faces':
      case 'back_faces':
      case 'left_faces':
      case 'right_faces': {
        const want =
          op.region === 'top_faces' ? 'TOP'
          : op.region === 'bottom_faces' ? 'BOTTOM'
          : op.region === 'front_faces' ? 'FRONT'
          : op.region === 'back_faces' ? 'BACK'
          : op.region === 'left_faces' ? 'LEFT'
          : 'RIGHT'
        const out = new Set<number>()
        for (const f of faces) {
          if (faceDirection(f.normal) === want) {
            for (const t of f.triangleIndices) out.add(t)
          }
        }
        // Organic meshes often over-merge faces — fall back to a Z band so the
        // paint still produces a visible second colour.
        if (out.size === 0) {
          if (want === 'TOP') {
            return selectTriangles(mesh, faces, {
              op: 'paint_region',
              extruder: op.extruder,
              zFraction: { min: 0.55, max: 1 },
            })
          }
          if (want === 'BOTTOM') {
            return selectTriangles(mesh, faces, {
              op: 'paint_region',
              extruder: op.extruder,
              zFraction: { min: 0, max: 0.45 },
            })
          }
        }
        return Array.from(out)
      }
    }
  }

  return []
}

export async function applyPaintRegion(
  mesh: BaseMesh,
  op: PaintParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const hasSelector =
    (op.faceIds && op.faceIds.length > 0) ||
    !!op.zFraction ||
    !!op.region
  if (!hasSelector) {
    throw new Error(
      'paint_region requires one of faceIds, zFraction, or region',
    )
  }

  const selected = selectTriangles(mesh, faces, op)
  if (selected.length === 0) {
    throw new Error(
      'paint_region selected 0 triangles — check faceIds/region against this mesh',
    )
  }

  const extruders = mesh.extruders.slice() as Array<'A' | 'B'>
  const target = op.extruder ?? 'B'
  for (const t of selected) {
    if (t >= 0 && t < extruders.length) extruders[t] = target
  }

  // No geometry change — reuse positions/normals/bbox.
  return {
    ...mesh,
    extruders,
  }
}
