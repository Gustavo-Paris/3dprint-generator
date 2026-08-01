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

/**
 * Measure how much logo fits the CLICKED face by marching from the anchor
 * along the two tangent axes and raycasting back onto the host. Marching
 * stops at a ledge (height discontinuity — pedestal→torso), at a silhouette
 * edge (ray miss — pedestal→floor), or at `maxHalfMm`. Smooth curvature
 * (cans, foreheads) produces small per-step deltas and keeps marching, so
 * the drape use-case is not penalized.
 *
 * Returns the maximum logo dimension (mm) that fits centered on the anchor:
 * the smaller of the two symmetric tangent spans. Callers clamp their
 * requested size with `Math.min(requested, extent)` — this function never
 * needs to be an upper bound for meshes larger than `maxHalfMm`.
 *
 * Why: sizing heuristics based on the GLOBAL mesh bbox produced logos that
 * dwarfed the local face on figurines (prod, 2026-07-31) — a 70 mm monogram
 * clicked onto a 20 mm pedestal band swallowed the base and the floor.
 */
export function measureLocalFaceExtent(
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  maxHalfMm: number,
): number {
  const STEP_MM = 1.5
  const LEDGE_MM = 2.5
  const PROBE_HEIGHT_MM = 4
  const [nx, ny, nz] = normal
  // tangent frame (same construction as ops/_shared makeFrame, inlined to
  // keep this module dependency-free)
  const ref: [number, number, number] =
    Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let tx = ref[1] * nz - ref[2] * ny
  let ty = ref[2] * nx - ref[0] * nz
  let tz = ref[0] * ny - ref[1] * nx
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl; ty /= tl; tz /= tl
  const bx = ny * tz - nz * ty
  const by = nz * tx - nx * tz
  const bz = nx * ty - ny * tx

  const dir: [number, number, number] = [-nx, -ny, -nz]
  const maxSteps = Math.max(1, Math.ceil((maxHalfMm + 2) / STEP_MM))

  const marchLimit = (du: number, dvx: number, dvy: number, dvz: number): number => {
    let prevH = 0
    for (let s = 1; s <= maxSteps; s++) {
      const d = s * STEP_MM * du
      const ox = center[0] + dvx * d + nx * PROBE_HEIGHT_MM
      const oy = center[1] + dvy * d + ny * PROBE_HEIGHT_MM
      const oz = center[2] + dvz * d + nz * PROBE_HEIGHT_MM
      const hit = raycastSoup([ox, oy, oz], dir, hostPositions)
      if (!hit) return (s - 1) * STEP_MM
      const h =
        (hit[0] - center[0]) * nx + (hit[1] - center[1]) * ny + (hit[2] - center[2]) * nz
      if (Math.abs(h - prevH) > LEDGE_MM) return (s - 1) * STEP_MM
      prevH = h
    }
    return maxSteps * STEP_MM
  }

  const uPlus = marchLimit(1, tx, ty, tz)
  const uMinus = marchLimit(-1, tx, ty, tz)
  const vPlus = marchLimit(1, bx, by, bz)
  const vMinus = marchLimit(-1, bx, by, bz)
  const uSpan = 2 * Math.min(uPlus, uMinus)
  const vSpan = 2 * Math.min(vPlus, vMinus)
  return Math.min(uSpan, vSpan)
}
