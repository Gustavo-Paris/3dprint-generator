/**
 * Project a planar logo solid onto a (possibly curved) host surface so the
 * logo follows the mesh instead of floating as a flat coin.
 *
 * For each logo vertex V:
 *   1. Split V into planar foot P + height h along placement normal N
 *   2. Raycast P along ±N against a local neighbourhood of host triangles
 *   3. Rewrite V = hit + (h − midH) · N  so relative thickness is preserved
 *      while the mid-plane of the logo rides the surface.
 *
 * On nearly-planar hosts (keychains, plaques) draping is skipped — raycast
 * noise on dense meshes was producing micro-spikes that slicers flag as
 * non-manifold garbage.
 */

/** Max peak-to-peak height (mm) along the placement normal among local host
 *  triangle centroids before we treat the surface as curved and drape. */
export const DRAPE_CURVATURE_MM = 0.4

/**
 * True when local host triangles already lie on a plane (within
 * `DRAPE_CURVATURE_MM`). Used to skip draping on flat plates / keychains.
 */
export function isLocallyPlanar(
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  toleranceMm = DRAPE_CURVATURE_MM,
): boolean {
  if (hostPositions.length < 9) return true
  const [nx, ny, nz] = normal
  const [cx, cy, cz] = center
  let minH = Infinity
  let maxH = -Infinity
  let samples = 0
  for (let i = 0; i < hostPositions.length; i += 9) {
    const x = (hostPositions[i] + hostPositions[i + 3] + hostPositions[i + 6]) / 3
    const y = (hostPositions[i + 1] + hostPositions[i + 4] + hostPositions[i + 7]) / 3
    const z = (hostPositions[i + 2] + hostPositions[i + 5] + hostPositions[i + 8]) / 3
    const h = (x - cx) * nx + (y - cy) * ny + (z - cz) * nz
    if (h < minH) minH = h
    if (h > maxH) maxH = h
    samples++
  }
  if (samples === 0) return true
  return maxH - minH <= toleranceMm
}

/** Keep host triangles whose centroid lies within `radius` of `center`. */
export function filterTrianglesNear(
  positions: Float32Array,
  center: readonly [number, number, number],
  radius: number,
): Float32Array {
  const r2 = radius * radius
  const out: number[] = []
  for (let i = 0; i < positions.length; i += 9) {
    const cx = (positions[i] + positions[i + 3] + positions[i + 6]) / 3
    const cy = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3
    const cz = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3
    const dx = cx - center[0]
    const dy = cy - center[1]
    const dz = cz - center[2]
    if (dx * dx + dy * dy + dz * dz <= r2) {
      for (let k = 0; k < 9; k++) out.push(positions[i + k])
    }
  }
  return new Float32Array(out)
}

/**
 * Möller–Trumbore ray/triangle. Returns t ≥ 0 along ray or null.
 * Ray: origin + t * dir (dir need not be unit).
 */
export function rayTriangleT(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number | null {
  const eps = 1e-8
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
  // pvec = dir × e2
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (det > -eps && det < eps) return null
  const invDet = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * invDet
  if (u < 0 || u > 1) return null
  // qvec = tvec × e1
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * invDet
  if (v < 0 || u + v > 1) return null
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet
  if (t < eps) return null
  return t
}

/**
 * Closest hit of a ray against a triangle soup. Returns the hit point or null.
 */
export function raycastSoup(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  positions: Float32Array,
): [number, number, number] | null {
  let bestT = Infinity
  let hit: [number, number, number] | null = null
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = dir
  for (let i = 0; i < positions.length; i += 9) {
    const t = rayTriangleT(
      ox, oy, oz, dx, dy, dz,
      positions[i], positions[i + 1], positions[i + 2],
      positions[i + 3], positions[i + 4], positions[i + 5],
      positions[i + 6], positions[i + 7], positions[i + 8],
    )
    if (t != null && t < bestT) {
      bestT = t
      hit = [ox + dx * t, oy + dy * t, oz + dz * t]
    }
  }
  return hit
}

/**
 * Drape a logo triangle-soup so its mid-plane (height `midH` along N from C)
 * rides the host surface. Relative thickness along N is preserved.
 *
 * Vertices whose ray misses the host are left unchanged (logo edge past the
 * mesh) — the later boolean clip removes stragglers.
 *
 * @param logoPositions  flat xyz soup of the placed (planar) logo
 * @param hostPositions  host mesh soup (preferably pre-filtered near the logo)
 * @param center         placement anchor (on / near the surface)
 * @param normal         unit placement normal (outward)
 * @param midH           signed height of the logo mid-plane along N from center
 *                       (the `normalShift` used when placing the flat logo)
 */
export function drapeLogoPositions(
  logoPositions: Float32Array,
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  midH: number,
): Float32Array {
  const [nx, ny, nz] = normal
  const [cx, cy, cz] = center
  // Cast from well outside the solid toward the surface.
  const span = 200 // mm — enough for any practical model size
  const out = new Float32Array(logoPositions.length)

  for (let i = 0; i < logoPositions.length; i += 3) {
    const vx = logoPositions[i]
    const vy = logoPositions[i + 1]
    const vz = logoPositions[i + 2]
    // Height of this vertex above the placement plane through center.
    const h = (vx - cx) * nx + (vy - cy) * ny + (vz - cz) * nz
    // Foot on the placement plane.
    const px = vx - h * nx
    const py = vy - h * ny
    const pz = vz - h * nz
    // Ray from outside along −N so we hit the outward face first.
    const ox = px + nx * span
    const oy = py + ny * span
    const oz = pz + nz * span
    const hit = raycastSoup([ox, oy, oz], [-nx, -ny, -nz], hostPositions)
    if (!hit) {
      out[i] = vx
      out[i + 1] = vy
      out[i + 2] = vz
      continue
    }
    // Preserve thickness relative to the logo mid-plane; mid rides the surface.
    const rel = h - midH
    out[i] = hit[0] + rel * nx
    out[i + 1] = hit[1] + rel * ny
    out[i + 2] = hit[2] + rel * nz
  }
  return out
}
