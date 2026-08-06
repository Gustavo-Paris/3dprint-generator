/**
 * Advisory mesh-validity analysis (Fase C gate, TASK-050).
 *
 * Pure topology check over a triangle-soup `Float32Array` (9 floats / triangle).
 * It answers the question a slicer cares about: is this mesh a closed, manifold
 * surface? It does NOT repair anything and it does NOT measure wall thickness
 * (deferred to a later phase).
 *
 * No THREE dependency on purpose — raw floats in, plain object out — so it runs
 * inside the geometry worker and in node unit tests alike.
 */

/** Above this triangle count we skip analysis (`analyzed: false`) rather than
 * pay the welding cost on the worker's critical path. The gate is advisory, so
 * not analyzing a huge mesh simply means no warning — never a false alarm. */
export const MAX_ANALYZE_TRIANGLES = 250_000

export type MeshValidityReport = {
  triangleCount: number
  /** False when the mesh exceeded MAX_ANALYZE_TRIANGLES and was skipped. */
  analyzed: boolean
  /** Open edges (incidence 1) — holes. Any > 0 means not watertight. */
  boundaryEdges: number
  /** Edges shared by more than 2 triangles — non-manifold. */
  nonManifoldEdges: number
  /** Triangles with two coincident (welded) vertices — zero area. */
  degenerateTriangles: number
  /** Triangles carrying a NaN/±Infinity coordinate — excluded from topology. */
  nonFiniteTriangles: number
  watertight: boolean
}

export type MeshBannerState =
  | { show: false }
  | { show: true; tone: 'info' | 'warn'; title: string; detail: string }

export type MeshValidityBannerOpts = {
  /**
   * LSF maquete (and similar multi-body skeletons): open edges between
   * independent members are expected. Never treat that as a print defect —
   * only non-finite coordinates remain a real warning.
   */
  expectMultiBody?: boolean
}

/**
 * Map a validity report to the advisory banner state.
 *
 * OrcaSlicer auto-repairs small openings, non-manifold edges and degenerate
 * triangles on import — a parametric plate-with-hole slices and prints fine
 * despite the ~88 hole-rim boundary edges JSCAD's BSP subtract leaves behind.
 * So those are an INFORMATIONAL note, not an alarm. Only non-finite coordinates
 * (NaN/±Infinity) are genuinely unprintable and keep a real warning.
 *
 * When `expectMultiBody` is set (LSF maquete), non-watertight multi-member
 * soups are expected and get a calm LSF-specific note instead of a hole warning.
 */
export function meshValidityBanner(
  report: MeshValidityReport | null,
  opts: MeshValidityBannerOpts = {},
): MeshBannerState {
  if (opts.expectMultiBody) {
    if (report && report.analyzed && report.nonFiniteTriangles > 0) {
      return {
        show: true,
        tone: 'warn',
        title: 'Malha com coordenadas inválidas',
        detail: 'pode falhar na impressão.',
      }
    }
    return {
      show: true,
      tone: 'info',
      title: 'Maquete LSF multi-corpo',
      detail:
        'aberturas entre membros são esperadas; perfil H2D usa tree support + brim.',
    }
  }

  if (!report || !report.analyzed || report.watertight) return { show: false }
  if (report.nonFiniteTriangles > 0) {
    return {
      show: true,
      tone: 'warn',
      title: 'Malha com coordenadas inválidas',
      detail: 'pode falhar na impressão.',
    }
  }
  return {
    show: true,
    tone: 'info',
    title: 'Pequenas aberturas na malha',
    detail: 'o slicer ajusta automaticamente ao imprimir.',
  }
}

function skipped(triangleCount: number): MeshValidityReport {
  return {
    triangleCount,
    analyzed: false,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    degenerateTriangles: 0,
    nonFiniteTriangles: 0,
    // Vacuously "watertight" so the advisory banner stays hidden for un-analyzed
    // meshes; consumers that care should gate on `analyzed` too.
    watertight: true,
  }
}

/**
 * Weld vertices within `weldTolerance`, then tally edge incidence across all
 * triangles to classify the surface.
 */
export function analyzeMeshValidity(
  positions: Float32Array,
  opts: { weldTolerance?: number; maxTriangles?: number } = {},
): MeshValidityReport {
  const tol = opts.weldTolerance ?? 1e-4
  const maxTriangles = opts.maxTriangles ?? MAX_ANALYZE_TRIANGLES
  const inv = 1 / tol
  const tol2 = tol * tol
  const triangleCount = Math.floor(positions.length / 9)

  if (triangleCount > maxTriangles) return skipped(triangleCount)

  // Spatial weld with neighbour probing. A plain round-to-cell hash splits two
  // genuinely-coincident vertices that straddle a cell boundary (e.g. 0.49·tol
  // vs 0.51·tol), inventing phantom holes on jittery STL imports. Probing the
  // 27 neighbouring cells and re-using any vertex within `tol` closes that gap.
  const buckets = new Map<string, number[]>() // cell key → vertex ids in cell
  const rx: number[] = []
  const ry: number[] = []
  const rz: number[] = [] // id → representative position
  const idOf = (x: number, y: number, z: number): number => {
    const cx = Math.round(x * inv)
    const cy = Math.round(y * inv)
    const cz = Math.round(z * inv)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const ids = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!ids) continue
          for (const id of ids) {
            const ex = rx[id] - x
            const ey = ry[id] - y
            const ez = rz[id] - z
            if (ex * ex + ey * ey + ez * ez <= tol2) return id
          }
        }
      }
    }
    const id = rx.length
    rx.push(x)
    ry.push(y)
    rz.push(z)
    const key = `${cx},${cy},${cz}`
    const arr = buckets.get(key)
    if (arr) arr.push(id)
    else buckets.set(key, [id])
    return id
  }

  const edgeIncidence = new Map<string, number>()
  const bump = (a: number, b: number): void => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    edgeIncidence.set(key, (edgeIncidence.get(key) ?? 0) + 1)
  }

  let degenerateTriangles = 0
  let nonFiniteTriangles = 0
  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9
    const x0 = positions[o], y0 = positions[o + 1], z0 = positions[o + 2]
    const x1 = positions[o + 3], y1 = positions[o + 4], z1 = positions[o + 5]
    const x2 = positions[o + 6], y2 = positions[o + 7], z2 = positions[o + 8]

    // A NaN/Infinity coordinate (failed boolean, malformed 3MF parseFloat, …)
    // would corrupt welding — count it and exclude it from topology rather than
    // let it masquerade as an ordinary degenerate triangle.
    if (
      !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(z0) ||
      !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(z1) ||
      !Number.isFinite(x2) || !Number.isFinite(y2) || !Number.isFinite(z2)
    ) {
      nonFiniteTriangles++
      continue
    }

    const v0 = idOf(x0, y0, z0)
    const v1 = idOf(x1, y1, z1)
    const v2 = idOf(x2, y2, z2)

    // Any repeated welded id ⇒ degenerate (zero-area). Its edges are
    // meaningless for manifold counting, so skip them.
    if (v0 === v1 || v1 === v2 || v0 === v2) {
      degenerateTriangles++
      continue
    }

    bump(v0, v1)
    bump(v1, v2)
    bump(v2, v0)
  }

  let boundaryEdges = 0
  let nonManifoldEdges = 0
  for (const count of edgeIncidence.values()) {
    if (count === 1) boundaryEdges++
    else if (count > 2) nonManifoldEdges++
  }

  return {
    triangleCount,
    analyzed: true,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    nonFiniteTriangles,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0 && nonFiniteTriangles === 0,
  }
}
