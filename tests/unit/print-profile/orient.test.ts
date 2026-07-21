import { describe, it, expect } from 'vitest'
import { planStandingOrientation } from '@/lib/print-profile/orient'

/** 8 bbox corner points (xyz triples) of a box sized sx×sy×sz at an offset. */
function boxCorners(
  sx: number,
  sy: number,
  sz: number,
  ox = 0,
  oy = 0,
  oz = 0,
): Float32Array {
  const pts: number[] = []
  for (const x of [0, sx]) {
    for (const y of [0, sy]) {
      for (const z of [0, sz]) {
        pts.push(x + ox, y + oy, z + oz)
      }
    }
  }
  return new Float32Array(pts)
}

function bbox(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[i + a])
      max[a] = Math.max(max[a], p[i + a])
    }
  }
  return {
    min,
    max,
    dims: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
  }
}

/** Signed volume of the tetrahedron a,b,c,d packed as 12 floats. */
function signedTetraVolume(p: Float32Array): number {
  const v = (i: number) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
  const [a, b, c, d] = [v(0), v(1), v(2), v(3)]
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
  const cross = [
    ac[1] * ad[2] - ac[2] * ad[1],
    ac[2] * ad[0] - ac[0] * ad[2],
    ac[0] * ad[1] - ac[1] * ad[0],
  ]
  return (ab[0] * cross[0] + ab[1] * cross[1] + ab[2] * cross[2]) / 6
}

describe('planStandingOrientation', () => {
  it('stands a lying plate up: thin→Y, longest→Z, grounded and centred', () => {
    // 40(X) × 82(Y) × 3.7(Z) — a medallion lying flat, thin axis is Z.
    const soup = boxCorners(40, 82, 3.7, 7, -3, 12)
    const plan = planStandingOrientation(soup)
    expect(plan.standing).toBe(true)

    const out = plan.apply(soup)
    const b = bbox(out)
    expect(b.dims[0]).toBeCloseTo(40, 3)
    expect(b.dims[1]).toBeCloseTo(3.7, 3)
    expect(b.dims[2]).toBeCloseTo(82, 3)
    // Grounded at z=0, centred on X and Y.
    expect(b.min[2]).toBeCloseTo(0, 3)
    expect(b.center[0]).toBeCloseTo(0, 3)
    expect(b.center[1]).toBeCloseTo(0, 3)
  })

  it('does not move the original input array', () => {
    const soup = boxCorners(40, 82, 3.7)
    const copy = new Float32Array(soup)
    const plan = planStandingOrientation(soup)
    const out = plan.apply(soup)
    expect(out).not.toBe(soup)
    expect(Array.from(soup)).toEqual(Array.from(copy))
  })

  it('piece already standing (thin=Y, max=Z) → standing with identity apply', () => {
    // 40(X) × 3.7(Y) × 82(Z), offset so identity is distinguishable from
    // ground-and-centre.
    const soup = boxCorners(40, 3.7, 82, 5, 2, 1)
    const plan = planStandingOrientation(soup)
    expect(plan.standing).toBe(true)

    const out = plan.apply(soup)
    expect(out).not.toBe(soup)
    expect(Array.from(out)).toEqual(Array.from(soup))
  })

  it('thick piece stays lying down', () => {
    const soup = boxCorners(20, 20, 15)
    const plan = planStandingOrientation(soup)
    expect(plan.standing).toBe(false)
    expect(Array.from(plan.apply(soup))).toEqual(Array.from(soup))
  })

  it('never mirrors: signed tetra volume keeps its sign after apply', () => {
    const soup = boxCorners(40, 82, 3.7) // triggers a real rotation
    const plan = planStandingOrientation(soup)
    expect(plan.standing).toBe(true)

    // Asymmetric tetrahedron, positive orientation (volume +40).
    const tetra = new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 8, 0,
      0, 0, 3,
    ])
    const before = signedTetraVolume(tetra)
    const after = signedTetraVolume(plan.apply(tetra))
    expect(before).toBeGreaterThan(0)
    // A proper rigid transform preserves signed volume exactly (mirroring
    // would flip the sign — and flip embossed text).
    expect(after).toBeCloseTo(before, 3)
  })

  it('two bodies transformed separately stay aligned', () => {
    // Body A: flat plate; body B: a small boss on top, sharing the z=3.7 face.
    const bodyA = boxCorners(40, 82, 3.7)
    const bodyB = boxCorners(10, 10, 2, 5, 5, 3.7)
    const combined = new Float32Array(bodyA.length + bodyB.length)
    combined.set(bodyA, 0)
    combined.set(bodyB, bodyA.length)

    const plan = planStandingOrientation(combined)
    expect(plan.standing).toBe(true)

    const outA = plan.apply(bodyA)
    const outB = plan.apply(bodyB)
    const outCombined = plan.apply(combined)

    // Per-body application matches the whole-soup application element-wise —
    // the translation is fixed at plan time, not recomputed per body.
    for (let i = 0; i < bodyA.length; i++) {
      expect(outA[i]).toBe(outCombined[i])
    }
    for (let i = 0; i < bodyB.length; i++) {
      expect(outB[i]).toBe(outCombined[bodyA.length + i])
    }

    // A point shared by both bodies maps to the same place.
    const shared = new Float32Array([5, 5, 3.7])
    const viaA = plan.apply(shared)
    const viaB = plan.apply(shared)
    expect(Array.from(viaA)).toEqual(Array.from(viaB))
  })
})
