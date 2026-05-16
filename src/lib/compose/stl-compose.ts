import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

export type ComposeInput = {
  /** Top mesh STL bytes (e.g., Meshy logo output) */
  top: Uint8Array
  /** Base mesh STL bytes (e.g., parametric trophy base) */
  base: Uint8Array
  /** Z height of the base. The top is placed so its min.Z sits at (baseHeight - overlap). */
  baseHeight: number
  /** Target XY dimension for the top piece — uniform scale to make max(bbox.x, bbox.y) = scaleTopTo */
  scaleTopTo: number
  /** Overlap in mm between top and base for slicer to merge cleanly. Default 0.5mm. */
  overlap?: number
}

/**
 * Compose a top mesh on top of a base mesh. Outputs a single binary STL containing
 * both meshes' triangles, with the top scaled and translated to sit on the base.
 *
 * Why simple concat (not CSG): the slicer treats overlapping closed manifold meshes
 * as a single solid. CSG would be more correct but ~100x slower and risk re-triangulating
 * the (potentially imperfect) Meshy output into a non-manifold state.
 */
export function composeOnTop(input: ComposeInput): Uint8Array {
  const overlap = input.overlap ?? 0.5

  const topPositions = parseBinarySTL(input.top)
  const basePositions = parseBinarySTL(input.base)

  if (topPositions.length === 0) {
    // Nothing to compose — just return the base
    return input.base
  }

  // Compute top bbox
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < topPositions.length; i += 3) {
    const x = topPositions[i], y = topPositions[i + 1], z = topPositions[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const maxXY = Math.max(sizeX, sizeY) || 1
  const scale = input.scaleTopTo / maxXY

  // Translation: center XY at origin, place min.Z at (baseHeight - overlap)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const targetMinZ = input.baseHeight - overlap

  // Transform top positions
  const transformedTop = new Array<number>(topPositions.length)
  for (let i = 0; i < topPositions.length; i += 3) {
    transformedTop[i]     = (topPositions[i]     - centerX) * scale
    transformedTop[i + 1] = (topPositions[i + 1] - centerY) * scale
    transformedTop[i + 2] = (topPositions[i + 2] - minZ)    * scale + targetMinZ
  }

  // Concatenate: base positions + transformed top positions
  const combined = new Array<number>(basePositions.length + transformedTop.length)
  for (let i = 0; i < basePositions.length; i++) combined[i] = basePositions[i]
  for (let i = 0; i < transformedTop.length; i++) combined[basePositions.length + i] = transformedTop[i]

  return serializeBinarySTL(combined)
}
