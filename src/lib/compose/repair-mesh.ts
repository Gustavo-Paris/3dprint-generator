import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

/**
 * Post-process a Meshy-generated STL to make it printable.
 *
 * Three transforms in order:
 *  1. Merge near-duplicate vertices (fixes the "N non-manifold edges" the
 *     slicer rejects — Meshy often emits multiple vertex copies at the same
 *     XYZ within float-rounding distance, leaving edges only one neighbor
 *     can see).
 *  2. Mirror X — Meshy image-to-3D consistently outputs the logo as if
 *     viewed from behind; flipping X un-mirrors it.
 *  3. Scale uniformly so the largest dimension is `targetMaxDim` mm (default
 *     60). Meshy outputs in normalized ~1-unit scale, which renders fine in
 *     the viewer but slicers default-import it as 1mm = unprintable.
 */
export function repairAndPrepareMesh(
  stl: Uint8Array,
  opts: { targetMaxDim?: number; mirrorX?: boolean; mergeTolerance?: number } = {},
): Uint8Array {
  const targetMaxDim = opts.targetMaxDim ?? 60
  const mirrorX = opts.mirrorX ?? true
  const mergeTolerance = opts.mergeTolerance ?? 1e-4

  const positions = parseBinarySTL(stl)
  if (positions.length === 0) return stl

  // 1. Merge near-duplicate vertices via three.js
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const merged = mergeVertices(geom, mergeTolerance)

  const idx = merged.getIndex()
  const pos = merged.getAttribute('position') as THREE.BufferAttribute
  const flat: number[] = []

  if (idx) {
    // Indexed: expand back to flat triangle positions
    const indexArr = idx.array as ArrayLike<number>
    for (let i = 0; i < indexArr.length; i++) {
      const vi = indexArr[i]
      flat.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      flat.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
  }

  // 2. Compute bbox to determine scale + center
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i], y = flat[i + 1], z = flat[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const sizeZ = maxZ - minZ
  const maxDim = Math.max(sizeX, sizeY, sizeZ) || 1
  const scale = targetMaxDim / maxDim

  // 3. Apply mirror (flip X) + scale, in one pass
  // If we mirror X, we must also reverse winding order on each triangle to
  // keep normals pointing outward — otherwise the slicer sees the mesh
  // inside-out. Reverse winding by swapping vertices 1 and 2 of each triangle.
  const out = new Array<number>(flat.length)
  for (let t = 0; t < flat.length; t += 9) {
    const ax = flat[t],     ay = flat[t + 1], az = flat[t + 2]
    const bx = flat[t + 3], by = flat[t + 4], bz = flat[t + 5]
    const cx = flat[t + 6], cy = flat[t + 7], cz = flat[t + 8]

    const xs = mirrorX ? -1 : 1
    // After flipping X, swap the 2nd and 3rd vertex to preserve outward normals.
    if (mirrorX) {
      out[t]     = ax * xs * scale; out[t + 1] = ay * scale; out[t + 2] = az * scale
      out[t + 3] = cx * xs * scale; out[t + 4] = cy * scale; out[t + 5] = cz * scale
      out[t + 6] = bx * xs * scale; out[t + 7] = by * scale; out[t + 8] = bz * scale
    } else {
      out[t]     = ax * scale; out[t + 1] = ay * scale; out[t + 2] = az * scale
      out[t + 3] = bx * scale; out[t + 4] = by * scale; out[t + 5] = bz * scale
      out[t + 6] = cx * scale; out[t + 7] = cy * scale; out[t + 8] = cz * scale
    }
  }

  return serializeBinarySTL(out)
}
