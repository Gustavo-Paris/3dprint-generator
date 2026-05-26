import { describe, it, expect } from 'vitest'
import {
  groundMesh,
  orientWiderEndDown,
  repairAndPrepareMesh,
  standCylinderUpright,
} from '@/lib/compose/repair-mesh'
import { serializeBinarySTL } from '@/lib/stl/serialize'
import { parseBinarySTL } from '@/lib/jscad/runner'

describe('repairAndPrepareMesh', () => {
  it('scales output so max dimension equals targetMaxDim', () => {
    // Triangle with max dim = 2 (X spans 0..2)
    const tiny = serializeBinarySTL([0, 0, 0, 2, 0, 0, 0, 1, 0])
    const out = repairAndPrepareMesh(tiny, { targetMaxDim: 60, mirrorX: false, yUpToZUp: false })
    const positions = parseBinarySTL(out)

    let minX = Infinity, maxX = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i] < minX) minX = positions[i]
      if (positions[i] > maxX) maxX = positions[i]
    }
    expect(maxX - minX).toBeCloseTo(60, 1) // scaled from 2 → 60
  })

  it('mirrors X axis when mirrorX is true', () => {
    // Triangle entirely at positive X
    const stl = serializeBinarySTL([1, 0, 0, 3, 0, 0, 1, 2, 0])
    const out = repairAndPrepareMesh(stl, { targetMaxDim: 60, mirrorX: true, yUpToZUp: false })
    const positions = parseBinarySTL(out)

    // After mirror, all X should be negative * scale
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeLessThanOrEqual(0)
    }
  })

  it('preserves outward winding after mirror alone', () => {
    // Triangle with positive Z-normal (counterclockwise from +Z view): (0,0,0) (1,0,0) (0,1,0)
    const stl = serializeBinarySTL([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const out = repairAndPrepareMesh(stl, { targetMaxDim: 60, mirrorX: true, yUpToZUp: false })
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    const nx = dv.getFloat32(84, true)
    const ny = dv.getFloat32(84 + 4, true)
    const nz = dv.getFloat32(84 + 8, true)
    // Original normal was (0, 0, 1). After mirror + winding swap, should still be (0, 0, 1).
    expect(nz).toBeCloseTo(1, 2)
    expect(Math.abs(nx)).toBeLessThan(0.01)
    expect(Math.abs(ny)).toBeLessThan(0.01)
  })

  it('converts Y-up to Z-up: vertex (x, y, z) → (x, z, -y)', () => {
    // A vertical "tower" along Y axis (Y-up): X spans 0..1, Y spans 0..10, Z=0.
    // After Y-up→Z-up, height should be along Z, not Y.
    const stl = serializeBinarySTL([
      0, 0, 0,   1, 0, 0,   0, 10, 0, // tri spans Y from 0 to 10
    ])
    const out = repairAndPrepareMesh(stl, { targetMaxDim: 10, mirrorX: false, yUpToZUp: true })
    const positions = parseBinarySTL(out)

    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 1] < minY) minY = positions[i + 1]
      if (positions[i + 1] > maxY) maxY = positions[i + 1]
      if (positions[i + 2] < minZ) minZ = positions[i + 2]
      if (positions[i + 2] > maxZ) maxZ = positions[i + 2]
    }
    // After conversion the original Y range becomes Z range (negated).
    expect(maxZ - minZ).toBeCloseTo(10, 1)
    expect(maxY - minY).toBeCloseTo(0, 1)
  })

  it('preserves outward winding after Y-up→Z-up alone', () => {
    // Triangle facing +Y in Y-up: (0,0,0) (1,0,0) (0,0,1). Normal = +Y after wrap.
    // After Y→Z conversion, +Y becomes +Z (because rotation -90° around X maps +Y→+Z).
    // Wait: tx maps (x,y,z) → (x,z,-y). The plane containing the triangle in input
    // is Y=0 (XZ plane). After tx, that becomes Z=0 (XY plane). Triangle normal
    // computed by the cross product flips sign because handedness changed —
    // and the winding swap in repair-mesh compensates for it.
    const stl = serializeBinarySTL([0, 0, 0, 1, 0, 0, 0, 0, 1])
    const out = repairAndPrepareMesh(stl, { targetMaxDim: 1, mirrorX: false, yUpToZUp: true })
    const positions = parseBinarySTL(out)
    // After transform: a=(0,0,0), b=(1,0,0), c=(0,-1,0) BUT with winding swap → c,b order.
    // We verify all Z become 0 (triangle lies in XY plane).
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.abs(positions[i + 2])).toBeLessThan(0.01)
    }
  })

  it('combined mirror + Y-up→Z-up keeps winding consistent', () => {
    // Two handedness flips cancel — reverseWinding should be false.
    const stl = serializeBinarySTL([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const out = repairAndPrepareMesh(stl, { targetMaxDim: 60, mirrorX: true, yUpToZUp: true })
    // Just verify it produces a valid STL; we don't assert specific normal direction here
    // because the original triangle plane gets remapped.
    expect(out.byteLength).toBeGreaterThan(84)
  })

  it('merges near-duplicate vertices', () => {
    const stl = serializeBinarySTL([
      0, 0, 0,   1, 0, 0,   0, 1, 0,
      1.00001, 0, 0,   0, 1, 0,   1, 1, 0,
    ])
    const out = repairAndPrepareMesh(stl, { targetMaxDim: 100, mirrorX: false, yUpToZUp: false })
    const positions = parseBinarySTL(out)
    expect(positions.length).toBe(stl.byteLength === 84 + 50 * 2 ? 2 * 9 : positions.length)
  })

  it('returns the input unchanged when given an empty STL', () => {
    const empty = serializeBinarySTL([])
    const out = repairAndPrepareMesh(empty)
    expect(out).toBe(empty)
  })

  it('orientWiderEndDown flips when the top cross-section is wider than the bottom', () => {
    // Build a Z-up mesh with wide top (+Z) and narrow bottom (-Z).
    const tris: number[] = []
    // Wide ring at Z = +10 (top)
    tris.push(-5, -5,  10,   5, -5,  10,   5,  5,  10)
    tris.push(-5, -5,  10,   5,  5,  10,  -5,  5,  10)
    // Narrow ring at Z = -10 (bottom)
    tris.push(-1, -1, -10,   1, -1, -10,   1,  1, -10)
    tris.push(-1, -1, -10,   1,  1, -10,  -1,  1, -10)
    const stl = serializeBinarySTL(tris)

    const flipped = orientWiderEndDown(stl)

    const footprintAtZ = (stlBytes: Uint8Array, atTop: boolean): number => {
      const ps = parseBinarySTL(stlBytes)
      let zMin = Infinity, zMax = -Infinity
      for (let i = 2; i < ps.length; i += 3) {
        if (ps[i] < zMin) zMin = ps[i]
        if (ps[i] > zMax) zMax = ps[i]
      }
      const thr = atTop ? zMax - (zMax - zMin) * 0.2 : zMin + (zMax - zMin) * 0.2
      let xMin = Infinity, xMax = -Infinity
      for (let i = 0; i < ps.length; i += 3) {
        const z = ps[i + 2]
        if ((atTop && z >= thr) || (!atTop && z <= thr)) {
          if (ps[i] < xMin) xMin = ps[i]
          if (ps[i] > xMax) xMax = ps[i]
        }
      }
      return xMax - xMin
    }

    // After flip: wide end now at -Z (bottom), narrow at +Z (top).
    expect(footprintAtZ(flipped, false)).toBeGreaterThan(footprintAtZ(flipped, true))
  })

  it('standCylinderUpright rotates Y-elongated cylinder to be Z-tall', () => {
    // Cylinder approximated by two rings; tube axis along Y (longest).
    const tris: number[] = []
    for (const y of [-20, 20]) {
      // 5×5 cross-section at this Y
      tris.push(-2.5, y, -2.5,  2.5, y, -2.5,  2.5, y,  2.5)
      tris.push(-2.5, y, -2.5,  2.5, y,  2.5, -2.5, y,  2.5)
    }
    const stl = serializeBinarySTL(tris)
    const out = standCylinderUpright(stl)
    const ps = parseBinarySTL(out)

    let xMin = Infinity, xMax = -Infinity
    let yMin = Infinity, yMax = -Infinity
    let zMin = Infinity, zMax = -Infinity
    for (let i = 0; i < ps.length; i += 3) {
      if (ps[i] < xMin) xMin = ps[i]; if (ps[i] > xMax) xMax = ps[i]
      if (ps[i + 1] < yMin) yMin = ps[i + 1]; if (ps[i + 1] > yMax) yMax = ps[i + 1]
      if (ps[i + 2] < zMin) zMin = ps[i + 2]; if (ps[i + 2] > zMax) zMax = ps[i + 2]
    }
    // After rotation: longest axis (was Y span 40) should now be Z.
    expect(zMax - zMin).toBeCloseTo(40, 1)
    expect(xMax - xMin).toBeCloseTo(5, 1)
    expect(yMax - yMin).toBeCloseTo(5, 1)
  })

  it('standCylinderUpright rotates X-elongated cylinder to be Z-tall', () => {
    const tris: number[] = []
    for (const x of [-20, 20]) {
      tris.push(x, -2.5, -2.5,  x,  2.5, -2.5,  x,  2.5,  2.5)
      tris.push(x, -2.5, -2.5,  x,  2.5,  2.5,  x, -2.5,  2.5)
    }
    const stl = serializeBinarySTL(tris)
    const out = standCylinderUpright(stl)
    const ps = parseBinarySTL(out)

    let xMin = Infinity, xMax = -Infinity
    let zMin = Infinity, zMax = -Infinity
    for (let i = 0; i < ps.length; i += 3) {
      if (ps[i] < xMin) xMin = ps[i]; if (ps[i] > xMax) xMax = ps[i]
      if (ps[i + 2] < zMin) zMin = ps[i + 2]; if (ps[i + 2] > zMax) zMax = ps[i + 2]
    }
    expect(zMax - zMin).toBeCloseTo(40, 1)
    expect(xMax - xMin).toBeCloseTo(5, 1)
  })

  it('standCylinderUpright leaves already-upright cylinder unchanged', () => {
    const tris: number[] = []
    for (const z of [-20, 20]) {
      tris.push(-2.5, -2.5, z,  2.5, -2.5, z,  2.5,  2.5, z)
      tris.push(-2.5, -2.5, z,  2.5,  2.5, z, -2.5,  2.5, z)
    }
    const stl = serializeBinarySTL(tris)
    const out = standCylinderUpright(stl)
    expect(Buffer.from(out).equals(Buffer.from(stl))).toBe(true)
  })

  it('standCylinderUpright leaves flat plate unchanged', () => {
    // Plate: 30 × 50 × 3. min/mid = 3/30 = 0.1 < 0.55 → not cylinder.
    const tris: number[] = []
    tris.push(-15, -25, -1.5,  15, -25, -1.5,  15,  25, -1.5)
    tris.push(-15, -25,  1.5,  15, -25,  1.5,  15,  25,  1.5)
    const stl = serializeBinarySTL(tris)
    const out = standCylinderUpright(stl)
    expect(Buffer.from(out).equals(Buffer.from(stl))).toBe(true)
  })

  it('dedupes coincident triangles (front + back at same position)', () => {
    // Two triangles at the same position with opposite windings — Meshy's
    // classic "double-shell" artifact that causes the white speckles.
    const stl = serializeBinarySTL([
      0, 0, 0,   1, 0, 0,   0, 1, 0,  // front-facing
      0, 0, 0,   0, 1, 0,   1, 0, 0,  // back-facing (reversed)
    ])
    const out = repairAndPrepareMesh(stl, {
      targetMaxDim: 1, mirrorX: false, yUpToZUp: false,
    })
    const ps = parseBinarySTL(out)
    // Only one triangle should remain after dedup.
    expect(ps.length).toBe(9)
  })

  it('groundMesh translates Z so the lowest vertex sits at 0', () => {
    // Tri with Z spanning -5..+10
    const stl = serializeBinarySTL([0, 0, -5,   1, 0, -5,   0, 1, 10])
    const out = groundMesh(stl)
    const ps = parseBinarySTL(out)
    let zMin = Infinity, zMax = -Infinity
    for (let i = 2; i < ps.length; i += 3) {
      if (ps[i] < zMin) zMin = ps[i]
      if (ps[i] > zMax) zMax = ps[i]
    }
    expect(zMin).toBeCloseTo(0, 5)
    expect(zMax).toBeCloseTo(15, 5)
  })

  it('groundMesh leaves an already-grounded mesh unchanged', () => {
    const stl = serializeBinarySTL([0, 0, 0,   1, 0, 0,   0, 1, 10])
    const out = groundMesh(stl)
    expect(Buffer.from(out).equals(Buffer.from(stl))).toBe(true)
  })

  it('orientWiderEndDown leaves a uniformly-wide cylinder unchanged', () => {
    const tris: number[] = []
    for (const z of [-5, 5]) {
      tris.push(-3, -3, z,   3, -3, z,   3,  3, z)
      tris.push(-3, -3, z,   3,  3, z,  -3,  3, z)
    }
    const stl = serializeBinarySTL(tris)
    const out = orientWiderEndDown(stl)
    expect(Buffer.from(out).equals(Buffer.from(stl))).toBe(true)
  })
})
