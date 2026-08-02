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

describe('drape quality (quadric smoothing + subdivision)', () => {
  /** Noisy half-cylinder shell: radius R with deterministic per-vertex radial
   *  noise — a stand-in for lumpy AI-generated (Meshy) surfaces. */
  function noisyCylinderSoup(R = 45, noise = 0.35, height = 40, seg = 72): Float32Array {
    const tris: number[] = []
    const jitter = (i: number, j: number) =>
      noise * Math.sin(i * 12.9898 + j * 78.233 + i * i * 0.7) // deterministic pseudo-noise
    const pt = (i: number, zi: number): [number, number, number] => {
      const a = -Math.PI / 2 + (i / seg) * Math.PI
      const r = R + jitter(i, zi)
      return [r * Math.sin(a), -r * Math.cos(a), zi === 0 ? 0 : height]
    }
    for (let i = 0; i < seg; i++) {
      const p00 = pt(i, 0), p10 = pt(i + 1, 0), p01 = pt(i, 1), p11 = pt(i + 1, 1)
      tris.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01)
    }
    return new Float32Array(tris)
  }

  it('filters host surface noise: draped mid-plane rides the smooth cylinder', () => {
    const R = 45
    const host = noisyCylinderSoup(R, 0.8, 40, 36)
    // flat logo slab footprint 24x14, thickness 1.4, mid-plane at h=0
    const logo: number[] = []
    for (let x = -12; x < 12; x += 2) {
      for (let z = 13; z < 27; z += 2) {
        // two thin triangles per cell at h=+0.7 (top face samples)
        logo.push(x, -R - 0.7, z, x + 2, -R - 0.7, z, x + 2, -R - 0.7, z + 2)
        logo.push(x, -R - 0.7, z, x + 2, -R - 0.7, z + 2, x, -R - 0.7, z + 2)
      }
    }
    const draped = drapeLogoPositions(
      new Float32Array(logo),
      host,
      [0, -R, 20],
      [0, -1, 0],
      0,
    )
    // every draped vertex should sit ~0.7mm proud of the IDEAL cylinder —
    // radial error vs ideal must be well below the 0.35mm host noise
    let maxErr = 0
    for (let i = 0; i < draped.length; i += 3) {
      const radial = Math.hypot(draped[i], draped[i + 1]) // distance from cyl axis
      const err = Math.abs(radial - (R + 0.7))
      if (err > maxErr) maxErr = err
    }
    expect(maxErr).toBeLessThan(0.3)
  })

  it('subdivides long logo edges so curved drapes do not facet', async () => {
    const { subdivideSoupToMaxEdge } = await import('@/lib/import/ops/drape-logo')
    // one large triangle, edges 20mm
    const soup = new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0])
    const out = subdivideSoupToMaxEdge(soup, 1.5)
    // area preserved
    const area = (p: Float32Array) => {
      let a = 0
      for (let i = 0; i < p.length; i += 9) {
        const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2]
        const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2]
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
        a += Math.hypot(cx, cy, cz) / 2
      }
      return a
    }
    expect(area(out)).toBeCloseTo(200, 3)
    // max edge below the limit
    let maxEdge = 0
    for (let i = 0; i < out.length; i += 9) {
      for (const [s, e] of [[0, 3], [3, 6], [6, 0]] as const) {
        const d = Math.hypot(
          out[i + e] - out[i + s],
          out[i + e + 1] - out[i + s + 1],
          out[i + e + 2] - out[i + s + 2],
        )
        if (d > maxEdge) maxEdge = d
      }
    }
    expect(maxEdge).toBeLessThanOrEqual(1.5 + 1e-6)
  })
})

describe('tiny-figurine scale (24mm Funko pedestal — prod regression 2026-08-02)', () => {
  /** Ø24 pedestal band, 8mm tall, with floor below and recessed body above —
   *  the scale where the old 12mm size floor produced boolean shrapnel. */
  function tinyPedestalScene(): Float32Array {
    const tris: number[] = []
    const R = 12, SEG = 48, Z0 = 0, Z1 = 8
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2
      const a1 = ((i + 1) / SEG) * Math.PI * 2
      const p = (a: number, z: number) => [R * Math.sin(a), -R * Math.cos(a), z]
      tris.push(...p(a0, Z0), ...p(a1, Z0), ...p(a1, Z1))
      tris.push(...p(a0, Z0), ...p(a1, Z1), ...p(a0, Z1))
    }
    // recessed body above (Ø16 cylinder from z=8 up)
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2
      const a1 = ((i + 1) / SEG) * Math.PI * 2
      const p = (a: number, z: number) => [8 * Math.sin(a), -8 * Math.cos(a), z]
      tris.push(...p(a0, 8), ...p(a1, 8), ...p(a1, 40))
      tris.push(...p(a0, 8), ...p(a1, 40), ...p(a0, 40))
    }
    return new Float32Array(tris)
  }

  it('measures a single-digit span instead of inflating to a 12mm floor', async () => {
    const { measureLocalFaceExtent } = await import('@/lib/import/ops/drape-logo')
    const coarse = measureLocalFaceExtent(tinyPedestalScene(), [0, -12, 4], [0, -1, 0], 22.5)
    const span = coarse < 15
      ? measureLocalFaceExtent(tinyPedestalScene(), [0, -12, 4], [0, -1, 0], Math.max(coarse * 0.75, 3))
      : coarse
    expect(span).toBeGreaterThanOrEqual(5)
    expect(span).toBeLessThanOrEqual(10)
  })
})

describe('per-axis spans + silhouette trim (wordmark fixes 2026-08-02)', () => {
  it('reports wide u-span and short v-span separately on a band', async () => {
    const { measureLocalFaceSpans } = await import('@/lib/import/ops/drape-logo')
    // 80-wide x 20-tall flat band at y=0 (normal -Y), floor below, recess above
    const tris: number[] = []
    const quad = (a: number[], b: number[], c: number[], d: number[]) =>
      tris.push(...a, ...b, ...c, ...a, ...c, ...d)
    quad([-40, 0, 0], [-40, 0, 20], [40, 0, 20], [40, 0, 0])
    quad([-80, 0, 0], [80, 0, 0], [80, 80, 0], [-80, 80, 0])          // floor
    quad([-40, 10, 20], [-40, 10, 90], [40, 10, 90], [40, 10, 20])    // recessed
    const spans = measureLocalFaceSpans(new Float32Array(tris), [0, 0, 10], [0, -1, 0], 35)
    expect(spans.uSpan).toBeGreaterThanOrEqual(60)
    expect(spans.vSpan).toBeGreaterThanOrEqual(14)
    expect(spans.vSpan).toBeLessThanOrEqual(24)
  })

  it('trims logo triangles fully past the face silhouette (no floating fins)', () => {
    // host: plane only on the LEFT half (x in [-30, 0]) at y=0
    const host = new Float32Array([
      -30, 0, -20, 0, 0, -20, 0, 0, 20,
      -30, 0, -20, 0, 0, 20, -30, 0, 20,
    ])
    // logo strip from x=-10 to x=+14 (right part hangs in the air)
    const logo: number[] = []
    for (let x = -10; x < 14; x += 2) {
      logo.push(x, -0.7, -3, x + 2, -0.7, -3, x + 2, -0.7, 3)
      logo.push(x, -0.7, -3, x + 2, -0.7, 3, x, -0.7, 3)
    }
    const draped = drapeLogoPositions(
      new Float32Array(logo), host, [-5, 0, 0], [0, -1, 0], 0,
    )
    expect(draped.length).toBeLessThan(logo.length)   // something was trimmed
    // every surviving vertex must be near the host plane (no flat-position spikes)
    for (let i = 1; i < draped.length; i += 3) {
      expect(Math.abs(draped[i])).toBeLessThan(1.5)
    }
    // and no surviving triangle may live ENTIRELY past the silhouette (x > 1)
    for (let t = 0; t < draped.length / 9; t++) {
      const xs = [draped[t * 9], draped[t * 9 + 3], draped[t * 9 + 6]]
      expect(Math.min(...xs)).toBeLessThanOrEqual(2)
    }
  })
})
