import { describe, it, expect } from 'vitest'
import { analyzeMeshValidity } from '@/lib/mesh/validity'

/** Build a triangle-soup Float32Array from a flat list of [x,y,z] vertices. */
function soup(...verts: number[][]): Float32Array {
  return new Float32Array(verts.flat())
}

// A unit tetrahedron's 4 corners.
const A = [0, 0, 0]
const B = [1, 0, 0]
const C = [0, 1, 0]
const D = [0, 0, 1]

describe('analyzeMeshValidity', () => {
  it('reports a closed tetrahedron as watertight with zero issues', () => {
    // 4 faces; every one of the 6 edges is shared by exactly 2 faces.
    const mesh = soup(
      ...[A, B, C],
      ...[A, B, D],
      ...[A, C, D],
      ...[B, C, D],
    )
    const r = analyzeMeshValidity(mesh)
    expect(r.triangleCount).toBe(4)
    expect(r.boundaryEdges).toBe(0)
    expect(r.nonManifoldEdges).toBe(0)
    expect(r.degenerateTriangles).toBe(0)
    expect(r.watertight).toBe(true)
  })

  it('flags open boundary edges (holes) when a face is missing → not watertight', () => {
    // Same tetra minus the BCD face: edges BC, BD, CD now appear only once.
    const mesh = soup(
      ...[A, B, C],
      ...[A, B, D],
      ...[A, C, D],
    )
    const r = analyzeMeshValidity(mesh)
    expect(r.boundaryEdges).toBe(3)
    expect(r.nonManifoldEdges).toBe(0)
    expect(r.watertight).toBe(false)
  })

  it('flags non-manifold edges when >2 triangles share one edge', () => {
    const E = [0.5, 0.5, 1]
    // Three triangles all sharing edge A–B (fan around it).
    const mesh = soup(
      ...[A, B, C],
      ...[A, B, D],
      ...[A, B, E],
    )
    const r = analyzeMeshValidity(mesh)
    // Exactly one edge (A–B) has incidence 3; the open fan has 6 boundary edges.
    expect(r.nonManifoldEdges).toBe(1)
    expect(r.boundaryEdges).toBe(6)
    expect(r.watertight).toBe(false)
  })

  it('counts degenerate triangles (two coincident vertices) and excludes their edges', () => {
    const mesh = soup(
      ...[A, A, B], // zero-area: two identical vertices
      ...[A, B, C],
    )
    const r = analyzeMeshValidity(mesh)
    expect(r.triangleCount).toBe(2)
    expect(r.degenerateTriangles).toBe(1)
  })

  it('welds near-coincident vertices within tolerance before counting topology', () => {
    // A and a near-duplicate A' separated by < weldTolerance must count as one
    // vertex, so the two faces still share a clean manifold edge.
    const Aprime = [1e-6, 0, 0]
    const mesh = soup(
      ...[A, B, C],
      ...[Aprime, C, B], // shares edge B–C with face 1 once A≈A' is welded
    )
    const r = analyzeMeshValidity(mesh)
    // Welded: the two faces share all 3 edges (each incidence 2) → 0 boundary
    // edges. WITHOUT welding, A and A' would split AB/CA into 6 distinct
    // single-incidence edges, so boundaryEdges===0 proves the weld happened.
    expect(r.boundaryEdges).toBe(0)
    expect(r.nonManifoldEdges).toBe(0)
  })

  it('welds coincident vertices that straddle a grid-cell boundary (no phantom holes)', () => {
    // P and P' are the "same" vertex but jittered across the 1e-4 cell boundary
    // (round(0.49)=0 vs round(0.51)=1), distance 2e-6 ≪ tol. A naive single-grid
    // hash would split them and invent 4 boundary edges; neighbour probing welds.
    const P = [0.49e-4, 5, 0]
    const Pprime = [0.51e-4, 5, 0]
    const Q = [10, 0, 0]
    const R = [10, 10, 0]
    const mesh = soup(
      ...[P, Q, R],
      ...[Pprime, R, Q], // shares all 3 edges with face 1 once P≈P' welds
    )
    const r = analyzeMeshValidity(mesh)
    expect(r.boundaryEdges).toBe(0)
    expect(r.nonManifoldEdges).toBe(0)
    expect(r.watertight).toBe(true)
  })

  it('treats an empty mesh as analyzed and watertight (no advisory)', () => {
    const r = analyzeMeshValidity(new Float32Array([]))
    expect(r.triangleCount).toBe(0)
    expect(r.analyzed).toBe(true)
    expect(r.watertight).toBe(true)
  })

  it('counts non-finite (NaN/Infinity) triangles separately and is never watertight', () => {
    const mesh = soup(
      ...[[NaN, 0, 0], B, C], // excluded from topology, counted
      ...[A, B, C],
    )
    const r = analyzeMeshValidity(mesh)
    expect(r.nonFiniteTriangles).toBe(1)
    expect(r.degenerateTriangles).toBe(0) // must NOT masquerade as degenerate
    expect(r.watertight).toBe(false)
  })

  it('skips analysis above the triangle cap (advisory never alarms on un-analyzed meshes)', () => {
    const mesh = soup(...[A, B, C]) // 1 triangle
    const r = analyzeMeshValidity(mesh, { maxTriangles: 0 })
    expect(r.analyzed).toBe(false)
    expect(r.triangleCount).toBe(1)
    expect(r.watertight).toBe(true) // vacuously — banner stays hidden
  })
})
