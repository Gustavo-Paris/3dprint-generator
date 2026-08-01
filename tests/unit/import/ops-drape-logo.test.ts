import { describe, it, expect } from 'vitest'
import {
  drapeLogoPositions,
  filterTrianglesNear,
  isLocallyPlanar,
  rayTriangleT,
  raycastSoup,
} from '@/lib/import/ops/drape-logo'

/** Axis-aligned unit square in XY at z=0, two tris covering [-5,5]². */
function flatPlaneSoup(z = 0): Float32Array {
  // two triangles: (-5,-5,z)-(5,-5,z)-(5,5,z) and (-5,-5,z)-(5,5,z)-(-5,5,z)
  return new Float32Array([
    -5, -5, z, 5, -5, z, 5, 5, z,
    -5, -5, z, 5, 5, z, -5, 5, z,
  ])
}

/** Coarse hemisphere shell (z ≥ 0) of radius R, centre origin — for curvature. */
function hemisphereSoup(R = 10, segments = 16): Float32Array {
  const tris: number[] = []
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments / 2; j++) {
      const u0 = (i / segments) * Math.PI * 2
      const u1 = ((i + 1) / segments) * Math.PI * 2
      const v0 = (j / (segments / 2)) * (Math.PI / 2)
      const v1 = ((j + 1) / (segments / 2)) * (Math.PI / 2)
      const p = (u: number, v: number) => [
        R * Math.sin(v) * Math.cos(u),
        R * Math.sin(v) * Math.sin(u),
        R * Math.cos(v),
      ]
      const a = p(u0, v0), b = p(u1, v0), c = p(u1, v1), d = p(u0, v1)
      tris.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  return new Float32Array(tris)
}

describe('rayTriangleT / raycastSoup', () => {
  it('hits a plane from above along −Z', () => {
    const soup = flatPlaneSoup(0)
    const hit = raycastSoup([0, 0, 10], [0, 0, -1], soup)
    expect(hit).not.toBeNull()
    expect(hit![2]).toBeCloseTo(0, 5)
  })

  it('returns null when ray misses', () => {
    const t = rayTriangleT(
      0, 0, 10, 0, 0, -1,
      10, 10, 0, 12, 10, 0, 11, 12, 0,
    )
    expect(t).toBeNull()
  })
})

describe('filterTrianglesNear', () => {
  it('keeps only triangles near the centre', () => {
    // plane at origin + a far triangle
    const near = flatPlaneSoup(0)
    const far = new Float32Array([100, 100, 0, 102, 100, 0, 101, 102, 0])
    const all = new Float32Array([...near, ...far])
    const filtered = filterTrianglesNear(all, [0, 0, 0], 20)
    expect(filtered.length).toBe(near.length)
  })
})

describe('isLocallyPlanar', () => {
  it('true for a flat plate', () => {
    expect(isLocallyPlanar(flatPlaneSoup(0), [0, 0, 0], [0, 0, 1])).toBe(true)
  })

  it('false for a curved hemisphere neighbourhood', () => {
    const host = hemisphereSoup(10, 16)
    // near the pole the surface still curves more than 0.4 mm over a logo-sized region
    expect(isLocallyPlanar(host, [0, 0, 10], [0, 0, 1], 0.4)).toBe(false)
  })
})

describe('drapeLogoPositions', () => {
  it('is nearly identity on a flat host (mid-plane already on surface)', () => {
    // Logo: thin slab mid at z=0, top z=+0.5, bottom z=-0.5 — already on plane z=0
    const logo = new Float32Array([
      // bottom
      -1, -1, -0.5, 1, -1, -0.5, 1, 1, -0.5,
      // top
      -1, -1, 0.5, 1, -1, 0.5, 1, 1, 0.5,
    ])
    const host = flatPlaneSoup(0)
    const out = drapeLogoPositions(logo, host, [0, 0, 0], [0, 0, 1], /* midH */ 0)
    for (let i = 0; i < logo.length; i++) {
      expect(out[i]).toBeCloseTo(logo[i], 4)
    }
  })

  it('drops mid-plane vertices onto a curved host', () => {
    // Hemisphere radius 10, place at the pole (0,0,10), normal +Z.
    // Flat logo mid-plane at z=10 — edges at x=±3 sit ABOVE the sphere
    // (sphere at x=3,y=0 is z=√(100-9)≈9.54), so undraped mid edges float.
    // midH=0 because the logo mid already sits at the anchor plane (normalShift=0).
    const R = 10
    const host = hemisphereSoup(R, 24)
    const logo = new Float32Array([
      // mid-plane quad corners at z=10 (floating at edges before drape)
      -3, -3, 10, 3, -3, 10, 3, 3, 10,
      -3, -3, 10, 3, 3, 10, -3, 3, 10,
    ])
    const out = drapeLogoPositions(logo, host, [0, 0, R], [0, 0, 1], /* midH */ 0)
    // Corner at (3,-3) on mid should drop onto the sphere: z ≈ √(R²−18) ≈ 9.06
    let found = false
    for (let i = 0; i < out.length; i += 3) {
      if (Math.abs(out[i] - 3) < 0.05 && Math.abs(out[i + 1] + 3) < 0.05) {
        found = true
        // On sphere: x²+y²+z² ≈ R²
        const r = Math.hypot(out[i], out[i + 1], out[i + 2])
        expect(r).toBeCloseTo(R, 0) // within ~1mm of the shell (coarse mesh)
        expect(out[i + 2]).toBeLessThan(R - 0.2) // dropped below the flat plane
      }
    }
    expect(found).toBe(true)
  })
})

describe('measureLocalFaceExtent (logo auto-fit to the clicked face)', () => {
  // Figurine-pedestal scenario: a 60x20 front band (normal -Y) with a floor
  // below (normal +Z) and a recessed torso plate behind/above. A logo sized
  // from the GLOBAL bbox used to dwarf the pedestal (prod bug 2026-07-31).
  function pedestalScene(): Float32Array {
    const tris: number[] = []
    const quad = (
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
      d: [number, number, number],
    ) => tris.push(...a, ...b, ...c, ...a, ...c, ...d)
    // pedestal front band at y=0: x∈[-30,30], z∈[0,20], normal -Y (CCW from -Y)
    quad([-30, 0, 0], [-30, 0, 20], [30, 0, 20], [30, 0, 0])
    // floor at z=0: x∈[-80,80], y∈[0,80], normal +Z
    quad([-80, 0, 0], [80, 0, 0], [80, 80, 0], [-80, 80, 0])
    // torso plate recessed 10mm: at y=10, x∈[-25,25], z∈[20,90], normal -Y
    quad([-25, 10, 20], [-25, 10, 90], [25, 10, 90], [25, 10, 20])
    return new Float32Array(tris)
  }

  it('caps a bbox-sized logo to the pedestal band height', async () => {
    const { measureLocalFaceExtent } = await import('@/lib/import/ops/drape-logo')
    const cap = measureLocalFaceExtent(
      pedestalScene(),
      [0, 0, 10],     // click mid-band
      [0, -1, 0],     // facing the viewer
      45,             // half of a 90mm requested logo
    )
    // v axis: ~10mm up (ledge to recessed torso) and ~10mm down (floor edge)
    expect(cap).toBeGreaterThanOrEqual(14)
    expect(cap).toBeLessThanOrEqual(24)
  })

  it('does not shrink a logo that fits a large flat plaque', async () => {
    const { measureLocalFaceExtent } = await import('@/lib/import/ops/drape-logo')
    const plaque: number[] = []
    plaque.push(-60, 0, -50, -60, 0, 70, 60, 0, 70, -60, 0, -50, 60, 0, 70, 60, 0, -50)
    const cap = measureLocalFaceExtent(
      new Float32Array(plaque),
      [0, 0, 10],
      [0, -1, 0],
      22.5, // 45mm logo
    )
    expect(cap).toBeGreaterThanOrEqual(45)
  })

  it('tolerates smooth can curvature (drape use-case) without harsh caps', async () => {
    const { measureLocalFaceExtent } = await import('@/lib/import/ops/drape-logo')
    // vertical cylinder shell, Ø66, height 100, front half
    const R = 33
    const tris: number[] = []
    const SEG = 64
    for (let i = 0; i < SEG; i++) {
      const a0 = -Math.PI / 2 + (i / SEG) * Math.PI
      const a1 = -Math.PI / 2 + ((i + 1) / SEG) * Math.PI
      const p0 = [R * Math.sin(a0), -R * Math.cos(a0)]
      const p1 = [R * Math.sin(a1), -R * Math.cos(a1)]
      tris.push(
        p0[0], p0[1], 0, p1[0], p1[1], 0, p1[0], p1[1], 100,
        p0[0], p0[1], 0, p1[0], p1[1], 100, p0[0], p0[1], 100,
      )
    }
    const cap = measureLocalFaceExtent(
      new Float32Array(tris),
      [0, -R, 50],   // front of the can, mid height
      [0, -1, 0],
      22.5,          // 45mm logo — typical can monogram
    )
    expect(cap).toBeGreaterThanOrEqual(40)
  })
})
