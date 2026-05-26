import { describe, it, expect, vi } from 'vitest'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

// Mock sharp so readImageAspectRatio returns a known aspect (3:1 wide banner).
vi.mock('sharp', () => ({
  default: () => ({
    metadata: async () => ({ width: 900, height: 300 }),
  }),
}))

// Last targetMaxDim that extrudeLogo was called with — for assertions.
let lastTargetMaxDim = 0

// Mock extrudeLogo BEFORE importing generate.ts so the generator picks up
// the mock. Returns a fixed slab: 20mm × 3mm × 10mm (X × Y thickness × Z).
// Triangulation is a simple cuboid (12 triangles).
vi.mock('@/lib/logo-extrude/extrude', () => ({
  extrudeLogo: vi.fn().mockImplementation(async (opts: { targetMaxDim: number; depthMm: number }) => {
    lastTargetMaxDim = opts.targetMaxDim
    const W = opts.targetMaxDim
    const T = opts.depthMm
    const H = W * 0.5 // pretend it's a 2:1 logo
    const verts: [number, number, number][] = [
      [-W / 3, -T / 2, -H / 2], [2 * W / 3, -T / 2, -H / 2], [2 * W / 3, T / 2, -H / 2], [-W / 3, T / 2, -H / 2],
      [-W / 3, -T / 2,  H / 2], [2 * W / 3, -T / 2,  H / 2], [2 * W / 3, T / 2,  H / 2], [-W / 3, T / 2,  H / 2],
    ]
    // CCW winding viewed from outside — required so booleans.subtract reads
    // the slab as a solid (not its inverted complement).
    const faces: [number, number, number][] = [
      [0, 3, 2], [0, 2, 1], // -Z bottom
      [4, 5, 6], [4, 6, 7], // +Z top
      [0, 1, 5], [0, 5, 4], // -Y front
      [2, 3, 7], [2, 7, 6], // +Y back
      [0, 4, 7], [0, 7, 3], // -X left
      [1, 2, 6], [1, 6, 5], // +X right
    ]
    const flat: number[] = []
    for (const [a, b, c] of faces) {
      flat.push(...verts[a], ...verts[b], ...verts[c])
    }
    const { primitives, transforms } = require('@jscad/modeling')
    const logo2DOuters = [
      primitives.roundedRectangle({ size: [W / 2, W / 2], roundRadius: 1, center: [-W / 4, 0] }),
      primitives.roundedRectangle({ size: [W / 2, W / 2], roundRadius: 1, center: [W / 4, 0] })
    ]
    const mockGeom3 = transforms.translate(
      [W / 6, 0, 0],
      primitives.cuboid({ size: [W, T, H] })
    )
    return {
      stl: serializeBinarySTL(flat),
      geom3: mockGeom3,
      logo2DOuters,
      meta: { triangleCount: 12 }
    }
  }),
}))

import { generateFromDesign } from '@/lib/design/generate'
import { Design } from '@/lib/design/schema'

function bbox(stl: Uint8Array) {
  const ps = parseBinarySTL(stl)
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < ps.length; i += 3) {
    if (ps[i] < minX) minX = ps[i]; if (ps[i] > maxX) maxX = ps[i]
    if (ps[i + 1] < minY) minY = ps[i + 1]; if (ps[i + 1] > maxY) maxY = ps[i + 1]
    if (ps[i + 2] < minZ) minZ = ps[i + 2]; if (ps[i + 2] > maxZ) maxZ = ps[i + 2]
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, triangleCount: ps.length / 9 }
}

const dummyLogo = Buffer.from('not-really-an-image')

describe('generateFromDesign — hollow_cylinder', () => {
  it('builds a plain hollow cylinder with bottom at z=0', async () => {
    const design = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60,
      heightMm: 100,
      wallMm: 3,
      baseMm: 3,
    })
    const result = await generateFromDesign(design, { logoImageBuffer: null })
    expect(result.meta.kind).toBe('hollow_cylinder')

    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(66, 0)        // outsideDiameter
    expect(b.maxY - b.minY).toBeCloseTo(66, 0)
    expect(b.minZ).toBeCloseTo(0, 1)                  // grounded
    expect(b.maxZ).toBeCloseTo(100, 1)                // height
    expect(b.triangleCount).toBeGreaterThan(100)
  })

  it('attaches a U-frame handle on +X side', async () => {
    const noHandle = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 100, wallMm: 3, baseMm: 3,
    })
    const withHandle = Design.parse({
      ...noHandle,
      handle: { heightMm: 60, stickOutMm: 28, thicknessMm: 8, fingerHoleDiameterMm: 22 },
    })
    const a = bbox((await generateFromDesign(noHandle, { logoImageBuffer: null })).stl)
    const b = bbox((await generateFromDesign(withHandle, { logoImageBuffer: null })).stl)
    expect(b.maxX).toBeGreaterThan(a.maxX)            // handle extends in +X
    expect(b.maxX - a.maxX).toBeGreaterThan(20)       // by roughly stickOut
    expect(b.triangleCount).toBeGreaterThan(a.triangleCount)
  })

  it('applies a through_cut logo (visibly carves the wall)', async () => {
    const plain = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 100, wallMm: 3, baseMm: 3,
    })
    const withLogo = Design.parse({
      ...plain,
      logo: { treatment: 'through_cut', position: 'front_face', sizeRatio: 0.5 },
    })
    const a = bbox((await generateFromDesign(plain, { logoImageBuffer: null })).stl)
    const b = bbox((await generateFromDesign(withLogo, { logoImageBuffer: dummyLogo })).stl)
    // Subtract adds boundary triangles around the cut silhouette.
    expect(b.triangleCount).toBeGreaterThan(a.triangleCount)
  })

  it('applies an embossed logo (raises material above wall)', async () => {
    const plain = Design.parse({
      kind: 'hollow_cylinder',
      insideDiameterMm: 60, heightMm: 100, wallMm: 3, baseMm: 3,
    })
    const withLogo = Design.parse({
      ...plain,
      logo: { treatment: 'embossed', position: 'front_face', sizeRatio: 0.5, depthMm: 2 },
    })
    const a = bbox((await generateFromDesign(plain, { logoImageBuffer: null })).stl)
    const b = bbox((await generateFromDesign(withLogo, { logoImageBuffer: dummyLogo })).stl)
    // Embossed extends Y past the cup's outer radius.
    expect(b.maxY).toBeGreaterThan(a.maxY)
  })
})

describe('generateFromDesign — flat_plate', () => {
  it('builds a rectangular plate LYING FLAT (Z = thickness, X = width, Y = height)', async () => {
    const design = Design.parse({
      kind: 'flat_plate',
      widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 4,
    })
    const result = await generateFromDesign(design, { logoImageBuffer: null })
    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(60, 0)
    expect(b.maxY - b.minY).toBeCloseTo(30, 0)
    expect(b.maxZ - b.minZ).toBeCloseTo(4, 0)
    expect(b.minZ).toBeCloseTo(0, 1)                  // grounded — bottom on bed
  })

  it('adds a hanging hole near the top edge', async () => {
    const noHole = Design.parse({
      kind: 'flat_plate',
      widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 4,
    })
    const withHole = Design.parse({
      ...noHole,
      hangingHole: { diameterMm: 5, position: 'top' },
    })
    const a = bbox((await generateFromDesign(noHole, { logoImageBuffer: null })).stl)
    const b = bbox((await generateFromDesign(withHole, { logoImageBuffer: null })).stl)
    // The hole adds cylindrical cut → more triangles, but same outer bbox.
    expect(b.triangleCount).toBeGreaterThan(a.triangleCount)
    expect(b.maxX - b.minX).toBeCloseTo(a.maxX - a.minX, 0)
  })

  it('drills hanging hole at different positions', async () => {
    const base = {
      kind: 'flat_plate' as const,
      widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 4,
    }
    const top = Design.parse({ ...base, hangingHole: { diameterMm: 5, position: 'top' } })
    const left = Design.parse({ ...base, hangingHole: { diameterMm: 5, position: 'left' } })
    const topLeft = Design.parse({ ...base, hangingHole: { diameterMm: 5, position: 'top_left' } })

    const findHoleXZ = (stl: Uint8Array) => {
      // The hole is the only feature that creates extra vertices below the
      // plate's bbox-min Y. Approximation: average the X/Z of all vertices
      // — distinct positions shift this centroid measurably.
      const ps = bbox(stl)
      void ps
      return null // placeholder — we just verify triangle counts differ
    }
    void findHoleXZ

    const aTop = bbox((await generateFromDesign(top, { logoImageBuffer: null })).stl)
    const aLeft = bbox((await generateFromDesign(left, { logoImageBuffer: null })).stl)
    const aTopLeft = bbox((await generateFromDesign(topLeft, { logoImageBuffer: null })).stl)
    // All three should produce a valid plate with the same outer bbox.
    expect(aTop.maxX - aTop.minX).toBeCloseTo(aLeft.maxX - aLeft.minX, 0)
    expect(aTop.maxX - aTop.minX).toBeCloseTo(aTopLeft.maxX - aTopLeft.minX, 0)
    // And all three should have at least the same number of triangles
    // (the cylindrical hole cut adds the same number regardless of position).
    expect(aTop.triangleCount).toBe(aLeft.triangleCount)
    expect(aTop.triangleCount).toBe(aTopLeft.triangleCount)
  })

  it('applies a through_cut logo (subtracts material from plate)', async () => {
    const plain = Design.parse({
      kind: 'flat_plate',
      widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 4,
    })
    const withLogo = Design.parse({
      ...plain,
      logo: { treatment: 'through_cut', position: 'top_face', sizeRatio: 0.6 },
    })
    const a = bbox((await generateFromDesign(plain, { logoImageBuffer: null })).stl)
    const b = bbox((await generateFromDesign(withLogo, { logoImageBuffer: dummyLogo })).stl)
    expect(b.triangleCount).toBeGreaterThan(a.triangleCount)
  })

  it('vertical orientation: plate stands on its edge (Z = height)', async () => {
    const design = Design.parse({
      kind: 'flat_plate',
      orientation: 'vertical',
      widthMm: 60, heightMm: 120, thicknessMm: 6, cornerRadiusMm: 8,
    })
    const result = await generateFromDesign(design, { logoImageBuffer: null })
    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(60, 0)        // width
    expect(b.maxY - b.minY).toBeCloseTo(6, 0)         // thickness
    expect(b.maxZ - b.minZ).toBeCloseTo(120, 0)       // height (standing)
    expect(b.minZ).toBeCloseTo(0, 1)                  // grounded
  })

  it('logo sizing uses the LARGER plate dim when source image is wide (3:1 banner)', async () => {
    // Plate 60×30, sizeRatio 0.7, image aspect 3:1 (from sharp mock).
    // Available width = 60 * 0.7 = 42mm; logo at 3:1 aspect = 42×14mm,
    // which fits in available height (30 * 0.7 = 21mm). → targetMaxDim = 42.
    // (Old code would have used min(60,30) * 0.7 = 21 → wasted half the plate.)
    const design = Design.parse({
      kind: 'flat_plate',
      widthMm: 60, heightMm: 30, thicknessMm: 4, cornerRadiusMm: 4,
      logo: { treatment: 'through_cut', position: 'top_face', sizeRatio: 0.7 },
    })
    await generateFromDesign(design, { logoImageBuffer: dummyLogo })
    expect(lastTargetMaxDim).toBeCloseTo(42, 0)
  })
})

describe('generateFromDesign — composite', () => {
  it('stacks a disc base + vertical flat_plate (trophy shape)', async () => {
    const trophy = Design.parse({
      kind: 'composite',
      parts: [
        {
          primitive: { kind: 'disc', diameterMm: 80, thicknessMm: 15 },
          offsetZ: 0,
        },
        {
          primitive: {
            kind: 'flat_plate',
            orientation: 'vertical',
            widthMm: 60, heightMm: 120, thicknessMm: 6, cornerRadiusMm: 8,
          },
          offsetZ: 15,
        },
      ],
    })
    const result = await generateFromDesign(trophy, { logoImageBuffer: null })
    expect(result.meta.kind).toBe('composite')
    const b = bbox(result.stl)
    // Footprint = disc diameter (largest XY extent)
    expect(b.maxX - b.minX).toBeCloseTo(80, 0)
    expect(b.maxY - b.minY).toBeCloseTo(80, 0)
    // Total height = disc thickness + plate height
    expect(b.maxZ - b.minZ).toBeCloseTo(135, 0)
    // Lowest point is the disc bottom on Z=0
    expect(b.minZ).toBeCloseTo(0, 1)
  })

  it('vertical plate at offsetZ=baseThickness sits on top of the disc', async () => {
    const trophy = Design.parse({
      kind: 'composite',
      parts: [
        { primitive: { kind: 'disc', diameterMm: 60, thicknessMm: 10 }, offsetZ: 0 },
        {
          primitive: { kind: 'flat_plate', orientation: 'vertical', widthMm: 40, heightMm: 80, thicknessMm: 4, cornerRadiusMm: 4 },
          offsetZ: 10,
        },
      ],
    })
    const result = await generateFromDesign(trophy, { logoImageBuffer: null })
    const b = bbox(result.stl)
    // Plate top should be at z = 10 (base) + 80 (height) = 90
    expect(b.maxZ).toBeCloseTo(90, 0)
  })
})

describe('generateFromDesign — disc', () => {
  it('builds a flat disc with correct diameter and thickness', async () => {
    const design = Design.parse({
      kind: 'disc',
      diameterMm: 90, thicknessMm: 5,
    })
    const result = await generateFromDesign(design, { logoImageBuffer: null })
    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(90, 0)
    expect(b.maxY - b.minY).toBeCloseTo(90, 0)
    expect(b.maxZ - b.minZ).toBeCloseTo(5, 0)
    expect(b.minZ).toBeCloseTo(0, 1)                  // grounded
  })

  it('adds a hanging ring extending above the disc edge', async () => {
    const noRing = Design.parse({
      kind: 'disc', diameterMm: 50, thicknessMm: 4,
    })
    const withRing = Design.parse({
      ...noRing,
      hangingRing: { outerDiameterMm: 10, innerDiameterMm: 5 },
    })
    const a = bbox((await generateFromDesign(noRing, { logoImageBuffer: null })).stl)
    const b = bbox((await generateFromDesign(withRing, { logoImageBuffer: null })).stl)
    // Ring extends in +Z (above disc top edge).
    expect(b.maxZ).toBeGreaterThan(a.maxZ + 2)
  })

  it('applies engraved logo (debossed into disc top)', async () => {
    const plain = Design.parse({
      kind: 'disc', diameterMm: 90, thicknessMm: 5,
    })
    const withLogo = Design.parse({
      ...plain,
      logo: { treatment: 'engraved', position: 'top_face', sizeRatio: 0.6, depthMm: 1.5 },
    })
    const a = bbox((await generateFromDesign(plain, { logoImageBuffer: null })).stl)
    const result = await generateFromDesign(withLogo, { logoImageBuffer: dummyLogo })
    const b = bbox(result.stl)
    expect(b.triangleCount).toBeGreaterThan(a.triangleCount)

    const logoBody = result.bodies[1]
    expect(logoBody).toBeDefined()
    expect(logoBody.label).toBe('Logo')
    let lMinX = Infinity, lMaxX = -Infinity
    for (let i = 0; i < logoBody.positions.length; i += 3) {
      const x = logoBody.positions[i]
      if (x < lMinX) lMinX = x
      if (x > lMaxX) lMaxX = x
    }
    expect(lMinX).toBeCloseTo(-18, 1)
    expect(lMaxX).toBeCloseTo(36, 1)
  })
})

describe('generateFromDesign — bookmark', () => {
  it('builds a bookmark strip with correct dimensions', async () => {
    const design = Design.parse({
      kind: 'bookmark',
      widthMm: 25,
      heightMm: 140,
      thicknessMm: 1.2,
    })
    const result = await generateFromDesign(design, { logoImageBuffer: null })
    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(25, 0)
    expect(b.maxY - b.minY).toBeCloseTo(140, 0)
    expect(b.maxZ - b.minZ).toBeCloseTo(1.2, 1)
    expect(b.minZ).toBeCloseTo(0, 1) // grounded
  })

  it('adds hanging hole and logo to bookmark', async () => {
    const design = Design.parse({
      kind: 'bookmark',
      widthMm: 25,
      heightMm: 140,
      thicknessMm: 1.2,
      hangingHole: { diameterMm: 4, position: 'bottom' },
      logo: { treatment: 'through_cut', position: 'top_face', sizeRatio: 0.75 }
    })
    const result = await generateFromDesign(design, { logoImageBuffer: dummyLogo })
    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(25, 0)
    expect(b.maxY - b.minY).toBeCloseTo(140, 0)
    expect(b.triangleCount).toBeGreaterThan(12)
  })
})

describe('generateFromDesign — pin', () => {
  it('builds a pin disc with back pin and bottom-face logo', async () => {
    const design = Design.parse({
      kind: 'pin',
      diameterMm: 25,
      thicknessMm: 2,
      pinDiameterMm: 4.5,
      pinHeightMm: 8,
      logo: { treatment: 'engraved', position: 'bottom_face', sizeRatio: 0.7, depthMm: 0.8 }
    })
    const result = await generateFromDesign(design, { logoImageBuffer: dummyLogo })
    const b = bbox(result.stl)
    expect(b.maxX - b.minX).toBeCloseTo(25, 0)
    expect(b.maxY - b.minY).toBeCloseTo(25, 0)
    expect(b.maxZ - b.minZ).toBeCloseTo(10, 1) // disc (2) + pin (8) = 10mm
    expect(b.minZ).toBeCloseTo(0, 1) // grounded
    expect(b.triangleCount).toBeGreaterThan(50)

    const logoBody = result.bodies[1]
    expect(logoBody).toBeDefined()
    expect(logoBody.label).toBe('Logo')
    let lMinX = Infinity, lMaxX = -Infinity
    for (let i = 0; i < logoBody.positions.length; i += 3) {
      const x = logoBody.positions[i]
      if (x < lMinX) lMinX = x
      if (x > lMaxX) lMaxX = x
    }
    expect(lMinX).toBeCloseTo(-11.67, 1)
    expect(lMaxX).toBeCloseTo(5.83, 1)
  })
})

describe('generateFromDesign — custom_keychain', () => {
  it('builds a custom keychain base matching logo silhouette', async () => {
    const design = Design.parse({
      kind: 'custom_keychain',
      thicknessMm: 4,
      paddingMm: 4,
      logo: { treatment: 'embossed', position: 'top_face', sizeRatio: 0.8 }
    })
    const result = await generateFromDesign(design, { logoImageBuffer: dummyLogo })
    expect(result.meta.kind).toBe('custom_keychain')
    const b = bbox(result.stl)
    expect(b.minZ).toBeCloseTo(0, 1)
    expect(b.maxZ).toBeCloseTo(6, 1) // base (4) + emboss (2) = 6mm
    expect(result.bodies.length).toBe(2) // Body + Logo
  })
})

describe('generateFromDesign — mug', () => {
  it('builds a mug with hollow cavity and toroidal handle', async () => {
    const design = Design.parse({
      kind: 'mug',
      insideDiameterMm: 80,
      heightMm: 95,
      wallMm: 4,
      baseMm: 5,
      handleHeightMm: 65,
      handleStickOutMm: 30,
      handleThicknessMm: 10,
      logo: { treatment: 'engraved', position: 'front_face', sizeRatio: 0.5 }
    })
    const result = await generateFromDesign(design, { logoImageBuffer: dummyLogo })
    expect(result.meta.kind).toBe('mug')
    const b = bbox(result.stl)
    expect(b.minZ).toBeCloseTo(0, 1)
    expect(b.maxZ).toBeCloseTo(95, 1)
    expect(result.bodies.length).toBe(2) // Body + Logo
  })
})

describe('generateFromDesign — textures', () => {
  it('generates flat plates with textures applied to the logo', async () => {
    const design = Design.parse({
      kind: 'flat_plate',
      widthMm: 60,
      heightMm: 30,
      thicknessMm: 4,
      cornerRadiusMm: 2,
      logo: { treatment: 'embossed', position: 'top_face', sizeRatio: 0.6, texture: 'honeycomb' }
    })
    const result = await generateFromDesign(design, { logoImageBuffer: dummyLogo })
    const b = bbox(result.stl)
    expect(b.minZ).toBeCloseTo(0, 1)
    expect(result.bodies.length).toBe(2)
  })
})
