/**
 * Drop unprintable micro-geometry from a triangle soup.
 *
 * Potrace → extrude logos often produce sub-nozzle edges (<0.15 mm) that
 * Bambu/Orca paint as white "mesh error" dots even when the solid is
 * watertight. Removing those tris (and any that become degenerate after)
 * keeps the silhouette while making the mesh slice-clean.
 */

/** Default min edge — only true numerical slivers, NOT design detail.
 *  Aggressive thresholds (0.12 mm) open holes in embossed logos and make
 *  them non-watertight; Bambu then paints worse garbage. */
export const DEFAULT_MIN_EDGE_MM = 0.02
/** Default min triangle area (mm²) — near-zero only. */
export const DEFAULT_MIN_AREA_MM2 = 1e-5

/**
 * Filter a flat xyz soup (9 floats / triangle). Returns a new Float32Array
 * with only triangles that pass the size gates.
 */
export function cleanTriangleSoup(
  positions: Float32Array,
  opts: { minEdgeMm?: number; minAreaMm2?: number } = {},
): Float32Array {
  const minEdge = opts.minEdgeMm ?? DEFAULT_MIN_EDGE_MM
  const minArea = opts.minAreaMm2 ?? DEFAULT_MIN_AREA_MM2
  const minEdge2 = minEdge * minEdge
  const out: number[] = []

  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]

    const abx = bx - ax, aby = by - ay, abz = bz - az
    const acx = cx - ax, acy = cy - ay, acz = cz - az
    const bcx = cx - bx, bcy = cy - by, bcz = cz - bz

    const ab2 = abx * abx + aby * aby + abz * abz
    const ac2 = acx * acx + acy * acy + acz * acz
    const bc2 = bcx * bcx + bcy * bcy + bcz * bcz
    if (ab2 < minEdge2 || ac2 < minEdge2 || bc2 < minEdge2) continue

    // area = 0.5 * ||AB × AC||
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const area = 0.5 * Math.hypot(nx, ny, nz)
    if (area < minArea) continue

    for (let k = 0; k < 9; k++) out.push(positions[i + k])
  }

  return new Float32Array(out)
}
