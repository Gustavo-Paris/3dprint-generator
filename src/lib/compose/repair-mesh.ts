import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

/**
 * Post-process a Meshy-generated STL to make it printable.
 *
 * Transforms applied in order:
 *  1. Merge near-duplicate vertices (fixes "N non-manifold edges" the slicer
 *     rejects).
 *  2. Optional Y-up → Z-up swap. Meshy outputs Y-up (OpenGL convention) but
 *     our viewer and slicers assume Z-up. Without this, the piece appears
 *     lying on its side in the viewer.
 *  3. Optional mirror X — Meshy image-to-3D consistently outputs the logo as
 *     if viewed from behind.
 *  4. Scale uniformly so the largest dimension is `targetMaxDim` mm.
 */
export function repairAndPrepareMesh(
  stl: Uint8Array,
  opts: {
    targetMaxDim?: number
    mirrorX?: boolean
    mergeTolerance?: number
    yUpToZUp?: boolean
  } = {},
): Uint8Array {
  const targetMaxDim = opts.targetMaxDim ?? 60
  const mirrorX = opts.mirrorX ?? true
  const yUpToZUp = opts.yUpToZUp ?? true
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

  // 2. Compute bbox to determine scale
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

  // 3. Build per-vertex transform: optional X mirror + optional Y-up→Z-up + scale.
  //
  // Y-up→Z-up rotation: (x, y, z) → (x, z, -y). This is rotation by -90° around X.
  // We compose this with the X mirror (if requested) into a single matrix applied
  // per-vertex below.
  //
  // Both X mirror AND Y-up→Z-up flip the orientation handedness, so each one
  // toggles whether we need to reverse triangle winding to keep normals outward.
  // Applying both flips twice → winding stays as-is. Applying one → reverse.
  const flipsWinding = (mirrorX ? 1 : 0) + (yUpToZUp ? 1 : 0)
  const reverseWinding = flipsWinding % 2 === 1

  const tx = (x: number, y: number, z: number): [number, number, number] => {
    const sx = mirrorX ? -x : x
    if (yUpToZUp) {
      return [sx * scale, z * scale, -y * scale]
    }
    return [sx * scale, y * scale, z * scale]
  }

  const out = new Array<number>(flat.length)
  for (let t = 0; t < flat.length; t += 9) {
    const [ax, ay, az] = tx(flat[t],     flat[t + 1], flat[t + 2])
    const [bx, by, bz] = tx(flat[t + 3], flat[t + 4], flat[t + 5])
    const [cx, cy, cz] = tx(flat[t + 6], flat[t + 7], flat[t + 8])
    if (reverseWinding) {
      out[t]     = ax; out[t + 1] = ay; out[t + 2] = az
      out[t + 3] = cx; out[t + 4] = cy; out[t + 5] = cz
      out[t + 6] = bx; out[t + 7] = by; out[t + 8] = bz
    } else {
      out[t]     = ax; out[t + 1] = ay; out[t + 2] = az
      out[t + 3] = bx; out[t + 4] = by; out[t + 5] = bz
      out[t + 6] = cx; out[t + 7] = cy; out[t + 8] = cz
    }
  }

  return serializeBinarySTL(out)
}
