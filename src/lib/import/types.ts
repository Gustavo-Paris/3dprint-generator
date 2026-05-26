/** Triangle-soup mesh with computed normals + global bbox. */
export interface BaseMesh {
  /** Float32Array of length triangleCount*9 — flat [x,y,z, x,y,z, x,y,z, ...]. */
  positions: Float32Array
  /** Per-triangle face normal — Float32Array length triangleCount*3. */
  normals: Float32Array
  /** Per-triangle extruder label, preserved from the source 3MF. */
  extruders: Array<'A' | 'B'>
  bbox: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
    center: [number, number, number]
  }
  triangleCount: number
}

/** A region of co-planar (within tolerance) connected triangles. */
export interface SemanticFace {
  id: number
  /** Unit normal of the face. */
  normal: [number, number, number]
  /** 3D centroid (face center of mass). */
  centroid: [number, number, number]
  areaMm2: number
  /** Indices into BaseMesh.positions identifying the triangles in this face.
   *  Each entry is the triangle index (0..triangleCount-1). */
  triangleIndices: number[]
  /** In-plane 2D bbox (after projecting triangles onto the face plane,
   *  origin at centroid, X = arbitrary tangent, Y = normal × X). */
  bboxOnPlane: { min: [number, number]; max: [number, number] }
}

export interface EditWarning {
  opIndex: number
  op: string
  reason: string
}
