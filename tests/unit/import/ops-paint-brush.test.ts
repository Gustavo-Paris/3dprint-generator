import { describe, it, expect } from 'vitest'
import {
  buildSmoothAdjacency,
  floodFillRegion,
  findNearestTriangle,
  applyPaintBrush,
} from '@/lib/import/ops/paint-brush'
import type { BaseMesh } from '@/lib/import/types'

/**
 * Two coplanar quads (4 tris) sharing a flat edge, plus a third quad folded
 * at 90° — the fold is a feature barrier so flood from the flat side must
 * not cross into the folded face.
 *
 * Layout (top view, Z up):
 *   flat A (z=0)     flat B (z=0)     wall C (x=2, faces +X)
 *   0---1---2        continues        folded at x=2
 *   | / | / |
 *   3---4---5
 */
function makeRidgedMesh(): BaseMesh {
  // verts: (0,0,0)(1,0,0)(2,0,0)(0,1,0)(1,1,0)(2,1,0)(2,0,1)(2,1,1)
  // Flat left: 0-1-4, 0-4-3
  // Flat right: 1-2-5, 1-5-4
  // Wall: 2-6-7, 2-7-5  (normals roughly +X, ~90° from flat +Z)
  const positions = new Float32Array([
    // tri 0 flat L
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    // tri 1 flat L
    0, 0, 0, 1, 1, 0, 0, 1, 0,
    // tri 2 flat R
    1, 0, 0, 2, 0, 0, 2, 1, 0,
    // tri 3 flat R
    1, 0, 0, 2, 1, 0, 1, 1, 0,
    // tri 4 wall
    2, 0, 0, 2, 0, 1, 2, 1, 1,
    // tri 5 wall
    2, 0, 0, 2, 1, 1, 2, 1, 0,
  ])
  // Approximate unit normals
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, // flat
    0, 0, 1, 0, 0, 1, // flat
    1, 0, 0, 1, 0, 0, // wall
  ])
  return {
    positions,
    normals,
    extruders: ['A', 'A', 'A', 'A', 'A', 'A'],
    triangleCount: 6,
    bbox: {
      min: [0, 0, 0],
      max: [2, 1, 1],
      size: [2, 1, 1],
      center: [1, 0.5, 0.5],
    },
  }
}

describe('paint_brush flood fill', () => {
  it('builds smooth adjacency that stops at sharp creases', () => {
    const mesh = makeRidgedMesh()
    const adj = buildSmoothAdjacency(mesh.positions, mesh.normals, mesh.triangleCount, 40)
    // Flat tris 0–3 should be connected; wall 4–5 connected to each other
    // but not to flat (90° > 40°)
    const flatReach = floodFillRegion(adj, 0)
    expect(flatReach.sort()).toEqual([0, 1, 2, 3])
    const wallReach = floodFillRegion(adj, 4)
    expect(wallReach.sort()).toEqual([4, 5])
  })

  it('fill mode paints only the closed region under the click', async () => {
    const mesh = makeRidgedMesh()
    // Click on flat side
    const painted = await applyPaintBrush(
      mesh,
      {
        op: 'paint_brush',
        point: [0.5, 0.5, 0],
        extruder: 'B',
        mode: 'fill',
        featureAngleDeg: 40,
        radiusMm: 12,
      },
      [],
    )
    // Flat = B, wall stays A
    expect(painted.extruders.slice(0, 4).every((e) => e === 'B')).toBe(true)
    expect(painted.extruders.slice(4).every((e) => e === 'A')).toBe(true)
  })

  it('radius mode still paints a sphere around the point', async () => {
    const mesh = makeRidgedMesh()
    const painted = await applyPaintBrush(
      mesh,
      {
        op: 'paint_brush',
        point: [0.3, 0.3, 0],
        extruder: 'B',
        mode: 'radius',
        radiusMm: 0.8,
        featureAngleDeg: 38,
      },
      [],
    )
    const nB = painted.extruders.filter((e) => e === 'B').length
    expect(nB).toBeGreaterThanOrEqual(1)
    expect(nB).toBeLessThan(6)
  })

  it('findNearestTriangle returns a valid index', () => {
    const mesh = makeRidgedMesh()
    const i = findNearestTriangle(mesh.positions, mesh.triangleCount, [1.5, 0.5, 0])
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(6)
  })
})
