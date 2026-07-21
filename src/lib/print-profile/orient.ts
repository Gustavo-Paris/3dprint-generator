/**
 * "Print standing" orientation decision for plate-like pieces
 * (medallions/pendants).
 *
 * Given the full triangle soup of a piece (flat xyz triples, all bodies
 * concatenated), decides whether the piece should be printed standing on its
 * thin edge and, if so, produces a rigid transform (proper rotation, det +1 —
 * never a mirror, which would flip embossed text) that maps the thin axis to
 * Y and the longest axis to Z, then grounds the piece (minZ → 0) and centres
 * it on X/Y.
 *
 * The translation is fixed at plan time from the FULL soup's rotated bbox, so
 * `apply` can be called on each body separately and they stay aligned.
 */

export interface OrientationPlan {
  standing: boolean
  /** Applies the plan's rigid transform. Returns a NEW Float32Array. */
  apply(p: Float32Array): Float32Array
}

/** Plates thicker than this never go standing. */
const MAX_THIN_MM = 6
/** Thin dimension must be at most this fraction of the mid dimension. */
const MAX_THIN_TO_MID_RATIO = 0.22

const identity = (p: Float32Array): Float32Array => new Float32Array(p)

/** Parity of a permutation of [0,1,2]: +1 even, -1 odd. */
function permutationParity(perm: readonly number[]): 1 | -1 {
  let inversions = 0
  for (let i = 0; i < perm.length; i++) {
    for (let j = i + 1; j < perm.length; j++) {
      if (perm[i] > perm[j]) inversions++
    }
  }
  return inversions % 2 === 0 ? 1 : -1
}

export function planStandingOrientation(all: Float32Array): OrientationPlan {
  if (all.length < 3) return { standing: false, apply: identity }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < all.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = all[i + a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }
  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  // Ascending by size; stable sort keeps ties deterministic.
  const order = [0, 1, 2].sort((a, b) => dims[a] - dims[b])
  const thinAxis = order[0]
  const midAxis = order[1]
  const maxAxis = order[2]
  const thin = dims[thinAxis]
  const mid = dims[midAxis]

  const isPlate = thin <= MAX_THIN_MM && thin <= MAX_THIN_TO_MID_RATIO * mid
  if (!isPlate) return { standing: false, apply: identity }

  // Already standing (thin on Y, longest on Z) — nothing to rotate.
  if (thinAxis === 1 && maxAxis === 2) return { standing: true, apply: identity }

  // Axis permutation: out.x ← in[midAxis], out.y ← in[thinAxis],
  // out.z ← in[maxAxis]. A pure permutation matrix has det = parity; when the
  // permutation is odd we flip the X row so det stays +1 (proper rotation, no
  // mirroring — X is later re-centred so the flip is invisible).
  const xSign = permutationParity([midAxis, thinAxis, maxAxis])

  // Fixed translation from the rotated bbox of the FULL soup: ground minZ→0,
  // centre X and Y. Computed once here — per-body apply() reuses it so
  // separately-transformed bodies stay aligned.
  let rMinX = Infinity
  let rMaxX = -Infinity
  let rMinY = Infinity
  let rMaxY = -Infinity
  let rMinZ = Infinity
  for (let i = 0; i + 2 < all.length; i += 3) {
    const rx = xSign * all[i + midAxis]
    const ry = all[i + thinAxis]
    const rz = all[i + maxAxis]
    if (rx < rMinX) rMinX = rx
    if (rx > rMaxX) rMaxX = rx
    if (ry < rMinY) rMinY = ry
    if (ry > rMaxY) rMaxY = ry
    if (rz < rMinZ) rMinZ = rz
  }
  const tx = -(rMinX + rMaxX) / 2
  const ty = -(rMinY + rMaxY) / 2
  const tz = -rMinZ

  const apply = (p: Float32Array): Float32Array => {
    const out = new Float32Array(p.length)
    for (let i = 0; i + 2 < p.length; i += 3) {
      out[i] = xSign * p[i + midAxis] + tx
      out[i + 1] = p[i + thinAxis] + ty
      out[i + 2] = p[i + maxAxis] + tz
    }
    return out
  }

  return { standing: true, apply }
}
