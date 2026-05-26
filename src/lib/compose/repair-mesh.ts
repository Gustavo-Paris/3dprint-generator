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
 *
 * For "this cup is upside-down" or "this cylinder is lying on its side"
 * concerns, compose with `standCylinderUpright` and `orientWiderEndDown`
 * downstream — they operate on already-repaired geometry.
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

  // 0. Dedupe co-located triangles. Meshy occasionally emits the same face
  // twice (with opposite windings, producing inside + outside coincident
  // faces) which causes z-fighting in WebGL viewers — the visible "white
  // speckles" all over the surface. Hashing each triangle by its sorted
  // vertex positions keeps only the first occurrence of each.
  const deduped = dedupeFaces(positions, mergeTolerance)

  // 1. Merge near-duplicate vertices via three.js
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(deduped, 3))
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

/**
 * If the mesh is elongated with a roughly-round/square cross-section
 * (cylinder, rod, vase, tall statuette), rotate so its longest axis becomes
 * Z. Returns input unchanged for plates, blobs, or anything ambiguous.
 *
 * Heuristic:
 *   - sorted dims [min, mid, max]
 *   - min/mid > 0.55 → cross-section dims are similar (round-ish)
 *   - mid/max < 0.75 → genuinely elongated, not cube-ish
 *
 * Use after repairAndPrepareMesh, before downstream bbox-based logic.
 */
export function standCylinderUpright(stl: Uint8Array): Uint8Array {
  const positions = parseBinarySTL(stl)
  if (positions.length === 0) return stl

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const dims: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ]
  const sorted = [...dims].sort((a, b) => a - b)
  const [minD, midD, maxD] = sorted
  if (maxD <= 0) return stl

  const roundCrossSection = minD / midD > 0.55
  const elongated = midD / maxD < 0.75
  if (!roundCrossSection || !elongated) return stl

  const longestAxis = dims.indexOf(maxD) as 0 | 1 | 2
  if (longestAxis === 2) return stl // already upright

  // Apply a proper rotation (preserves handedness ⇒ no winding flip).
  //   X-longest: rotate -90° around Y → (x,y,z) → (-z, y,  x)
  //   Y-longest: rotate +90° around X → (x,y,z) → ( x,-z,  y)
  const tx: (x: number, y: number, z: number) => [number, number, number] =
    longestAxis === 0
      ? (x, y, z) => [-z, y, x]
      : (x, y, z) => [x, -z, y]

  const out = new Array<number>(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const [a, b, c] = tx(positions[i], positions[i + 1], positions[i + 2])
    out[i] = a; out[i + 1] = b; out[i + 2] = c
  }
  return serializeBinarySTL(out)
}

/**
 * Drop triangles whose sorted-vertex hash already appeared. Catches both
 * exact duplicates and reversed-winding duplicates (a back-face slapped on
 * top of a front-face, which Meshy emits for hollow shells).
 *
 * Tolerance buckets coordinates into a grid so near-coincident vertices
 * hash to the same key.
 */
function dedupeFaces(positions: Float32Array, tolerance: number): Float32Array {
  const inv = 1 / Math.max(tolerance, 1e-6)
  const seen = new Set<string>()
  const out: number[] = []
  for (let i = 0; i < positions.length; i += 9) {
    type Pt = [number, number, number]
    const tri: [Pt, Pt, Pt] = [
      [positions[i], positions[i + 1], positions[i + 2]],
      [positions[i + 3], positions[i + 4], positions[i + 5]],
      [positions[i + 6], positions[i + 7], positions[i + 8]],
    ]
    const sorted = [...tri].sort((a, b) =>
      a[0] !== b[0] ? a[0] - b[0]
      : a[1] !== b[1] ? a[1] - b[1]
      : a[2] - b[2],
    )
    const key =
      Math.round(sorted[0][0] * inv) + ',' +
      Math.round(sorted[0][1] * inv) + ',' +
      Math.round(sorted[0][2] * inv) + '|' +
      Math.round(sorted[1][0] * inv) + ',' +
      Math.round(sorted[1][1] * inv) + ',' +
      Math.round(sorted[1][2] * inv) + '|' +
      Math.round(sorted[2][0] * inv) + ',' +
      Math.round(sorted[2][1] * inv) + ',' +
      Math.round(sorted[2][2] * inv)
    if (seen.has(key)) continue
    seen.add(key)
    for (let k = 0; k < 9; k++) out.push(positions[i + k])
  }
  return new Float32Array(out)
}

/**
 * Translate the mesh upward so its lowest vertex sits at Z = 0. Required for
 * meshes generated by Meshy (centered around origin) before they go to a
 * viewer / slicer that assumes Z = 0 is the print bed.
 */
export function groundMesh(stl: Uint8Array): Uint8Array {
  const positions = parseBinarySTL(stl)
  if (positions.length === 0) return stl
  let minZ = Infinity
  for (let i = 2; i < positions.length; i += 3) {
    if (positions[i] < minZ) minZ = positions[i]
  }
  if (!isFinite(minZ) || minZ === 0) return stl
  const out = new Array<number>(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    out[i]     = positions[i]
    out[i + 1] = positions[i + 1]
    out[i + 2] = positions[i + 2] - minZ
  }
  return serializeBinarySTL(out)
}

/**
 * If the top 20% of the mesh has a wider XY footprint than the bottom 20%,
 * flip Z so the wider end rests on the print bed. Returns the input unchanged
 * when bottom is wider or comparable. Operates on already-Z-up geometry.
 */
export function orientWiderEndDown(stl: Uint8Array): Uint8Array {
  const positions = parseBinarySTL(stl)
  if (positions.length === 0) return stl

  const flat: number[] = Array.from(positions)
  if (!detectFlipZ(flat, false)) return stl

  // Flip Z and reverse winding to preserve outward normals.
  const out = new Array<number>(flat.length)
  for (let t = 0; t < flat.length; t += 9) {
    out[t]     = flat[t];     out[t + 1] = flat[t + 1]; out[t + 2] = -flat[t + 2]
    out[t + 3] = flat[t + 6]; out[t + 4] = flat[t + 7]; out[t + 5] = -flat[t + 8]
    out[t + 6] = flat[t + 3]; out[t + 7] = flat[t + 4]; out[t + 8] = -flat[t + 5]
  }
  return serializeBinarySTL(out)
}

/**
 * Heuristic: should we flip Z so the wider end faces -Z (the print bed)?
 *
 * We compute post-Y-up→Z-up Z coordinates, slice the mesh into a top 20% band
 * and a bottom 20% band, measure the XY footprint in each band, and flip when
 * the top band is meaningfully wider (≥15%) than the bottom band. This fixes
 * Meshy outputs where the natural "base" of an object (can rim, vase foot,
 * statue plinth) comes out on top instead of the floor.
 */
function detectFlipZ(flat: number[], yUpToZUp: boolean): boolean {
  // Compute Z range using the same transform Z that downstream will see.
  const zOf = (i: number) => (yUpToZUp ? -flat[i + 1] : flat[i + 2])
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i < flat.length; i += 3) {
    const z = zOf(i)
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
  }
  const zRange = zMax - zMin
  if (zRange <= 0) return false
  const topThr = zMax - zRange * 0.2
  const botThr = zMin + zRange * 0.2

  // Footprint = max(spanX, spanY) within each band.
  let topMinX = Infinity, topMaxX = -Infinity, topMinY2 = Infinity, topMaxY2 = -Infinity
  let botMinX = Infinity, botMaxX = -Infinity, botMinY2 = Infinity, botMaxY2 = -Infinity

  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i]
    // The "horizontal" axes after Y-up→Z-up are X and (formerly Z). If
    // yUpToZUp is on, the new Y is the old Z.
    const yPost = yUpToZUp ? flat[i + 2] : flat[i + 1]
    const z = zOf(i)
    if (z >= topThr) {
      if (x < topMinX) topMinX = x; if (x > topMaxX) topMaxX = x
      if (yPost < topMinY2) topMinY2 = yPost; if (yPost > topMaxY2) topMaxY2 = yPost
    }
    if (z <= botThr) {
      if (x < botMinX) botMinX = x; if (x > botMaxX) botMaxX = x
      if (yPost < botMinY2) botMinY2 = yPost; if (yPost > botMaxY2) botMaxY2 = yPost
    }
  }

  const topW = Math.max(topMaxX - topMinX, topMaxY2 - topMinY2)
  const botW = Math.max(botMaxX - botMinX, botMaxY2 - botMinY2)
  if (!isFinite(topW) || !isFinite(botW) || botW <= 0) return false
  return topW > botW * 1.15
}
