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
  const nVerts = logoPositions.length / 3

  // Pass 1 — raycast every vertex foot onto the host (ground truth).
  const rayH = new Float64Array(nVerts)
  const hitMask = new Uint8Array(nVerts)
  let hitSum = 0
  let hitCount = 0
  for (let i = 0, vi = 0; i < logoPositions.length; i += 3, vi++) {
    const dx0 = logoPositions[i] - cx
    const dy0 = logoPositions[i + 1] - cy
    const dz0 = logoPositions[i + 2] - cz
    const h = dx0 * nx + dy0 * ny + dz0 * nz
    const px = logoPositions[i] - h * nx
    const py = logoPositions[i + 1] - h * ny
    const pz = logoPositions[i + 2] - h * nz
    const hit = raycastSoup(
      [px + nx * span, py + ny * span, pz + nz * span],
      [-nx, -ny, -nz],
      hostPositions,
    )
    if (hit) {
      const hh = (hit[0] - cx) * nx + (hit[1] - cy) * ny + (hit[2] - cz) * nz
      rayH[vi] = hh
      hitMask[vi] = 1
      hitSum += hh
      hitCount++
    }
  }
  if (hitCount === 0) return logoPositions.slice() // nothing to drape onto
  const avgH = hitSum / hitCount

  // Pass 2 — smooth surface height per vertex. The quadric fit filters the
  // lumps of noisy AI-generated hosts, but is CLAMPED to ±0.6 mm of the
  // raycast truth where a ray hit: unbounded extrapolation flattened at wide
  // wrap angles and lifted logo edges tangentially off cylinders.
  const CLAMP_MM = 0.6
  const quad = fitHostQuadric(hostPositions, center, normal)
  const ref: [number, number, number] = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let tx = ref[1] * nz - ref[2] * ny
  let ty = ref[2] * nx - ref[0] * nz
  let tz = ref[0] * ny - ref[1] * nx
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl; ty /= tl; tz /= tl
  const bx2 = ny * tz - nz * ty
  const by2 = nz * tx - nx * tz
  const bz2 = nx * ty - ny * tx

  const out = new Float32Array(logoPositions.length)
  for (let i = 0, vi = 0; i < logoPositions.length; i += 3, vi++) {
    const dx0 = logoPositions[i] - cx
    const dy0 = logoPositions[i + 1] - cy
    const dz0 = logoPositions[i + 2] - cz
    const h = dx0 * nx + dy0 * ny + dz0 * nz
    const u = dx0 * tx + dy0 * ty + dz0 * tz
    const v = dx0 * bx2 + dy0 * by2 + dz0 * bz2
    let hs: number
    if (quad) {
      const q = quad(u, v)
      hs = hitMask[vi]
        ? Math.min(rayH[vi] + CLAMP_MM, Math.max(rayH[vi] - CLAMP_MM, q))
        : q
    } else {
      hs = hitMask[vi] ? rayH[vi] : avgH
    }
    const rel = h - midH
    out[i] = cx + u * tx + v * bx2 + (hs + rel) * nx
    out[i + 1] = cy + u * ty + v * by2 + (hs + rel) * ny
    out[i + 2] = cz + u * tz + v * bz2 + (hs + rel) * nz
  }

  // Pass 3 — trim triangles fully past the face silhouette (all 3 rays
  // missed). For embossed logos those triangles are appended to the model
  // as-is, so without trimming they stick out as a fin hanging in the air
  // where the host curves away (prod, 2026-08-02).
  const kept: number[] = []
  for (let t = 0; t < nVerts / 3; t++) {
    const anyHit = hitMask[t * 3] || hitMask[t * 3 + 1] || hitMask[t * 3 + 2]
    if (!anyHit) continue
    for (let k = 0; k < 9; k++) kept.push(out[t * 9 + k])
  }
  return new Float32Array(kept)
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
  const { uSpan, vSpan } = measureLocalFaceSpans(hostPositions, center, normal, maxHalfMm)
  return Math.min(uSpan, vSpan)
}

/**
 * Free room around the click on the host face, along the tangent frame.
 * Asymmetric on purpose: a click near the bottom of a pedestal has little
 * room "down" and a lot "up" — callers must SHIFT the logo toward the roomy
 * side, not only scale it (prod, 2026-08-05: 5G logo hanging off the base).
 */
export type LocalFaceRoom = {
  /** Distance from click along +u (reading direction) until ledge/miss. */
  uPlus: number
  uMinus: number
  /** Distance from click along +v (text-up) until ledge/miss. */
  vPlus: number
  vMinus: number
  /** Total free width / height (uPlus+uMinus, vPlus+vMinus). */
  uSpan: number
  vSpan: number
  /** Unit tangent (reading) and bitangent (up) used for the march. */
  tangent: [number, number, number]
  bitangent: [number, number, number]
}

/** Per-axis variant of `measureLocalFaceExtent`: returns the symmetric spans
 *  along both tangent axes separately. Wide logos (wordmarks) only need to
 *  fit their HEIGHT into the short axis — capping the max dimension by the
 *  min span shrank a 3:1 wordmark to a third of the available width. */
export function measureLocalFaceSpans(
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  maxHalfMm: number,
): { uSpan: number; vSpan: number } {
  const room = measureLocalFaceRoom(hostPositions, center, normal, maxHalfMm)
  // Symmetric spans (legacy callers): 2 × the tighter side so a centered logo
  // never overhangs. Prefer measureLocalFaceRoom + fitLogoIntoRoom for new code.
  return {
    uSpan: 2 * Math.min(room.uPlus, room.uMinus),
    vSpan: 2 * Math.min(room.vPlus, room.vMinus),
  }
}

export function measureLocalFaceRoom(
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
  maxHalfMm: number,
): LocalFaceRoom {
  // Scale-adaptive marching: the original fixed 1.5/2.5/4 mm constants were
  // tuned on ≥60 mm meshes; on a 24 mm figurine the ledge threshold exceeded
  // the whole pedestal band and the probe overshot the surface. All three
  // converge to the original values for maxHalfMm ≥ ~15.
  const STEP_MM = Math.min(1.5, Math.max(0.35, maxHalfMm / 10))
  // Slightly tighter ledge than before so a pedestal→floor transition is
  // caught even when the bottom disk is still "hit" by the probe ray.
  const LEDGE_MM = Math.min(2.0, Math.max(0.7, maxHalfMm * 0.18))
  const PROBE_HEIGHT_MM = Math.min(4, Math.max(1.2, maxHalfMm / 3))
  const [nx, ny, nz] = normal
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

  // On cylinders the u-march wraps the circumference and reports a huge free
  // width — a flat 45 mm monogram then "fits" and hangs in the air. Cap only
  // when the IMMEDIATE patch under the click is curved (not when a far ledge
  // like pedestal→torso makes the full host non-planar — that still wants a
  // wide wordmark on a flat band).
  let uP = uPlus
  let uM = uMinus
  const curveR = Math.min(8, Math.max(3, maxHalfMm * 0.4))
  const curvePatch = filterTrianglesNear(hostPositions, center, curveR)
  const curved =
    curvePatch.length >= 9 && !isLocallyPlanar(curvePatch, center, normal)
  if (curved && Math.abs(nz) < 0.55) {
    // Hard ceiling: ~1.35× free vertical room (readable monogram, no wrap).
    const vRoom = vPlus + vMinus
    const uCap = Math.max(10, vRoom * 1.35)
    uP = Math.min(uP, uCap / 2)
    uM = Math.min(uM, uCap / 2)
  }

  return {
    uPlus: uP,
    uMinus: uM,
    vPlus,
    vMinus,
    uSpan: uP + uM,
    vSpan: vPlus + vMinus,
    tangent: [tx, ty, tz],
    bitangent: [bx, by, bz],
  }
}

/**
 * Scale a logo of size (logoW × logoH) into the free room, and return the
 * in-plane shift (along room.tangent / room.bitangent) that keeps the logo
 * fully on the host when the click is off-center (near a ledge).
 *
 * Margin (default 8%) keeps a hair of shell around the monogram so the
 * boolean doesn't nibble the pedestal rim.
 */
export function fitLogoIntoRoom(
  logoW: number,
  logoH: number,
  room: LocalFaceRoom,
  margin = 0.08,
): { fitFactor: number; shiftU: number; shiftV: number; finalW: number; finalH: number } {
  const availW = Math.max(0.1, room.uSpan * (1 - margin))
  const availH = Math.max(0.1, room.vSpan * (1 - margin))
  const fitFactor = Math.min(1, availW / Math.max(logoW, 1e-6), availH / Math.max(logoH, 1e-6))
  const finalW = logoW * fitFactor
  const finalH = logoH * fitFactor
  // Center of available band relative to the click:
  // band u ∈ [−uMinus, +uPlus] → midpoint at (uPlus − uMinus) / 2.
  const shiftU = (room.uPlus - room.uMinus) / 2
  const shiftV = (room.vPlus - room.vMinus) / 2
  return { fitFactor, shiftU, shiftV, finalW, finalH }
}

/** True when the host near the click is curved enough (or is a side wall) that
 *  the planar logo must be draped — otherwise it floats as a flat coin. */
export function shouldDrapeLogo(
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
): boolean {
  // Side / near-vertical walls: always drape (figurine pedestal, can, mug).
  if (Math.abs(normal[2]) < 0.55) return true
  if (hostPositions.length < 9) return false
  return !isLocallyPlanar(hostPositions, center, normal)
}

/**
 * Split triangles until no edge exceeds `maxEdgeMm` (longest-edge midpoint
 * bisection). Coarse extruded-logo triangles otherwise facet visibly when
 * draped over curvature — bending happens only at vertices.
 */
export function subdivideSoupToMaxEdge(
  positions: Float32Array,
  maxEdgeMm: number,
): Float32Array {
  const limitSq = maxEdgeMm * maxEdgeMm
  let tris: number[] = Array.from(positions)
  // Each pass splits every over-limit triangle once; repeat until stable.
  for (let pass = 0; pass < 32; pass++) {
    const next: number[] = []
    let split = false
    for (let i = 0; i < tris.length; i += 9) {
      const ax = tris[i], ay = tris[i + 1], az = tris[i + 2]
      const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5]
      const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8]
      const ab = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2
      const bc = (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2
      const ca = (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2
      const longest = Math.max(ab, bc, ca)
      if (longest <= limitSq) {
        next.push(ax, ay, az, bx, by, bz, cx, cy, cz)
        continue
      }
      split = true
      if (longest === ab) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2
        next.push(ax, ay, az, mx, my, mz, cx, cy, cz)
        next.push(mx, my, mz, bx, by, bz, cx, cy, cz)
      } else if (longest === bc) {
        const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2
        next.push(ax, ay, az, bx, by, bz, mx, my, mz)
        next.push(ax, ay, az, mx, my, mz, cx, cy, cz)
      } else {
        const mx = (cx + ax) / 2, my = (cy + ay) / 2, mz = (cz + az) / 2
        next.push(ax, ay, az, bx, by, bz, mx, my, mz)
        next.push(mx, my, mz, bx, by, bz, cx, cy, cz)
      }
    }
    tris = next
    if (!split) break
  }
  return new Float32Array(tris)
}

type BasisTerm = (u: number, v: number) => number

/** Least-squares fit of h(u,v) over the given basis terms (normal equations +
 *  Gaussian elimination, scale-aware pivot). Returns coefficients or null
 *  when the system is rank-deficient for these samples. */
function fitBasis(
  samples: Array<[number, number, number]>,
  basis: BasisTerm[],
): number[] | null {
  const M = basis.length
  const ATA: number[][] = Array.from({ length: M }, () => new Array(M + 1).fill(0))
  let scale = 0
  for (const [u, v, h] of samples) {
    const row = basis.map((t) => t(u, v))
    for (let r = 0; r < M; r++) {
      for (let c = 0; c < M; c++) ATA[r][c] += row[r] * row[c]
      ATA[r][M] += row[r] * h
    }
  }
  for (let r = 0; r < M; r++) scale = Math.max(scale, Math.abs(ATA[r][r]))
  const eps = scale * 1e-9 + 1e-12
  for (let col = 0; col < M; col++) {
    let piv = col
    for (let r = col + 1; r < M; r++) {
      if (Math.abs(ATA[r][col]) > Math.abs(ATA[piv][col])) piv = r
    }
    if (Math.abs(ATA[piv][col]) < eps) return null
    if (piv !== col) [ATA[piv], ATA[col]] = [ATA[col], ATA[piv]]
    for (let r = 0; r < M; r++) {
      if (r === col) continue
      const f = ATA[r][col] / ATA[col][col]
      for (let c = col; c <= M; c++) ATA[r][c] -= f * ATA[col][c]
    }
  }
  return ATA.map((row, r) => row[M] / row[r])
}

/** Basis ladder: full quadric first, then progressively reduced bases for
 *  rank-deficient patches (e.g. two vertex rows make v² collinear with 1). */
const BASIS_LADDER: BasisTerm[][] = [
  [() => 1, (u) => u, (_u, v) => v, (u) => u * u, (u, v) => u * v, (_u, v) => v * v],
  [() => 1, (u) => u, (_u, v) => v, (u) => u * u, (_u, v) => v * v],
  [() => 1, (u) => u, (_u, v) => v, (u) => u * u],
  [() => 1, (u) => u, (_u, v) => v, (_u, v) => v * v],
  [() => 1, (u) => u, (_u, v) => v],
]

/** Fit a smooth quadric height field to the local host patch. Returns an
 *  evaluator or null when the patch is too small / multi-surfaced for the
 *  fit to be trustworthy (callers fall back to per-vertex raycasting).
 *
 *  Why: AI-generated (Meshy) surfaces are lumpy; per-vertex raycast drape
 *  transfers every lump into the logo (prod, 2026-08-01). A quadric follows
 *  planes, cylinders and gentle domes while filtering vertex noise. */
export function fitHostQuadric(
  hostPositions: Float32Array,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
): ((u: number, v: number) => number) | null {
  const [nx, ny, nz] = normal
  const ref: [number, number, number] = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let tx = ref[1] * nz - ref[2] * ny
  let ty = ref[2] * nx - ref[0] * nz
  let tz = ref[0] * ny - ref[1] * nx
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl; ty /= tl; tz /= tl
  const bx = ny * tz - nz * ty
  const by = nz * tx - nx * tz
  const bz = nx * ty - ny * tx

  const HEIGHT_WINDOW_MM = 12
  const samples: Array<[number, number, number]> = []
  for (let i = 0; i < hostPositions.length; i += 9) {
    // skip triangles facing away from the placement normal (back shells)
    const ux = hostPositions[i + 3] - hostPositions[i]
    const uy = hostPositions[i + 4] - hostPositions[i + 1]
    const uz = hostPositions[i + 5] - hostPositions[i + 2]
    const vx = hostPositions[i + 6] - hostPositions[i]
    const vy = hostPositions[i + 7] - hostPositions[i + 1]
    const vz = hostPositions[i + 8] - hostPositions[i + 2]
    const fnx = uy * vz - uz * vy
    const fny = uz * vx - ux * vz
    const fnz = ux * vy - uy * vx
    if (fnx * nx + fny * ny + fnz * nz <= 0) continue
    for (let k = 0; k < 9; k += 3) {
      const dx = hostPositions[i + k] - center[0]
      const dy = hostPositions[i + k + 1] - center[1]
      const dz = hostPositions[i + k + 2] - center[2]
      const h = dx * nx + dy * ny + dz * nz
      if (Math.abs(h) > HEIGHT_WINDOW_MM) continue
      samples.push([dx * tx + dy * ty + dz * tz, dx * bx + dy * by + dz * bz, h])
    }
  }
  if (samples.length < 12) return null
  for (const basis of BASIS_LADDER) {
    const q = fitBasis(samples, basis)
    if (!q) continue
    // Reject fits that do not actually describe the patch (mixed surfaces).
    let sse = 0
    for (const [u, v, h] of samples) {
      let fit = 0
      for (let t = 0; t < basis.length; t++) fit += q[t] * basis[t](u, v)
      const e = h - fit
      sse += e * e
    }
    if (Math.sqrt(sse / samples.length) > 3) continue
    return (u: number, v: number) => {
      let fit = 0
      for (let t = 0; t < basis.length; t++) fit += q[t] * basis[t](u, v)
      return fit
    }
  }
  return null
}
