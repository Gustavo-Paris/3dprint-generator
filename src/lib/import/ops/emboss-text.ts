import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { baseMeshToGeom3, geom3ToBaseMesh, loadJscad } from './_shared'
import type Geom3 from '@jscad/modeling/src/geometries/geom3/type'

type EmbossTextParams = Extract<Op, { op: 'emboss_text' }>

/**
 * Emboss or engrave text glyphs onto a face of the mesh.
 *
 * Text rendering: vectorText() returns stroke segments [[x0,y0],[x1,y1]].
 * Each segment is expanded via path2.close() + expansions.offset() into a
 * rounded 2D outline, then extruded linearly.
 *
 * Why not geom2.fromPoints quads: thin flat quads produce BSP coplanarity
 * issues in JSCAD 2.x union ops, causing the base mesh to be silently
 * discarded. The path2+offset route produces rounded closed outlines with
 * well-behaved topology for subsequent boolean operations.
 */
export async function applyEmbossText(
  mesh: BaseMesh,
  op: EmbossTextParams,
  faces: SemanticFace[],
): Promise<BaseMesh> {
  const face = faces[op.faceId]
  if (!face) throw new Error(`face ${op.faceId} out of range (have ${faces.length})`)

  const {
    text,
    extrusions,
    booleans,
    transforms,
    geometries,
    expansions,
  } = await loadJscad()

  // vectorText returns Array<[[x1,y1],[x2,y2]]> — one 2-point stroke per segment.
  const segments = text.vectorText({ height: op.sizeMm }, op.text) as Array<[[number, number], [number, number]]>

  if (segments.length === 0) {
    // No renderable glyphs (e.g. all spaces) — return mesh unchanged.
    return mesh
  }

  // Stroke radius: ~6% of glyph size (half of 12% stroke width), min 0.2mm.
  const strokeRadius = Math.max(op.sizeMm * 0.06, 0.2)

  // Embed the stroke slightly below the face so the union sees a proper
  // intersection — avoids JSCAD BSP issues with exactly coplanar faces.
  const EMBED = 0.01
  const extrudeHeight = op.depthMm + EMBED

  // For embossed: shift origin to (centroid - EMBED along normal) so the
  // extrusion starts just inside the mesh and protrudes by depthMm.
  // For engraved: shift origin to (centroid - depthMm along normal) to cut in.
  const depthShift = op.treatment === 'embossed' ? -EMBED : -op.depthMm

  // Build tangent frame for the face (for in-plane offset application).
  const n = face.normal
  const abs0 = Math.abs(n[0]), abs1 = Math.abs(n[1]), abs2 = Math.abs(n[2])
  const seed: [number, number, number] =
    abs0 < abs1 && abs0 < abs2 ? [1, 0, 0] : abs1 < abs2 ? [0, 1, 0] : [0, 0, 1]
  const sdot = seed[0] * n[0] + seed[1] * n[1] + seed[2] * n[2]
  const t: [number, number, number] = [
    seed[0] - sdot * n[0],
    seed[1] - sdot * n[1],
    seed[2] - sdot * n[2],
  ]
  const tl = Math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2) || 1
  t[0] /= tl; t[1] /= tl; t[2] /= tl
  const bv: [number, number, number] = [
    n[1] * t[2] - n[2] * t[1],
    n[2] * t[0] - n[0] * t[2],
    n[0] * t[1] - n[1] * t[0],
  ]

  // Translation origin for all strokes (face centroid + depth shift along normal + in-plane offset).
  const wx = face.centroid[0] + op.offsetMm[0] * t[0] + op.offsetMm[1] * bv[0] + depthShift * n[0]
  const wy = face.centroid[1] + op.offsetMm[0] * t[1] + op.offsetMm[1] * bv[1] + depthShift * n[1]
  const wz = face.centroid[2] + op.offsetMm[0] * t[2] + op.offsetMm[1] * bv[2] + depthShift * n[2]

  // Rotation: map local +Z to face normal.
  // dot(Z, n) = n[2]; rotation axis = Z × n = [-n[1], n[0], 0]
  const dot = Math.max(-1, Math.min(1, n[2]))

  const base = await baseMeshToGeom3(mesh) as Geom3
  let result: Geom3 = base
  const cutters: Geom3[] = []

  for (const [[sx0, sy0], [sx1, sy1]] of segments) {
    // Build a rounded thick stroke via path2 offset.
    const path = geometries.path2.fromPoints({}, [[sx0, sy0], [sx1, sy1]])
    const closed = geometries.path2.close(path)
    const outline = expansions.offset(
      { delta: strokeRadius, corners: 'round', segments: 8 },
      closed,
    )
    let stroke = extrusions.extrudeLinear({ height: extrudeHeight }, outline) as Geom3

    // Rotate to align +Z with face normal.
    if (dot < 0.9999) {
      if (dot < -0.9999) {
        stroke = transforms.rotateX(Math.PI, stroke) as Geom3
      } else {
        const angle = Math.acos(dot)
        const axisX = -n[1]
        const axisY = n[0]
        const alen = Math.sqrt(axisX * axisX + axisY * axisY) || 1
        if (Math.abs(axisY / alen) >= Math.abs(axisX / alen)) {
          stroke = transforms.rotateY(angle * Math.sign(axisY), stroke) as Geom3
        } else {
          stroke = transforms.rotateX(angle * Math.sign(axisX), stroke) as Geom3
        }
      }
    }

    // Translate to face surface.
    stroke = transforms.translate([wx, wy, wz], stroke) as Geom3

    if (op.treatment === 'embossed') {
      // Incrementally union each stroke with the mesh.
      // Unioning strokes first, then unioning the combined result with the mesh
      // produces degenerate CSG geometry — incremental per-stroke union is robust.
      result = booleans.union(result, stroke) as Geom3
    } else {
      cutters.push(stroke)
    }
  }

  if (op.treatment === 'engraved') {
    for (const cutter of cutters) {
      result = booleans.subtract(result, cutter) as Geom3
    }
  }

  return geom3ToBaseMesh(result, mesh.extruders[0] ?? 'A')
}
