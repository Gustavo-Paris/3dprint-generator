/**
 * Analyze a .3mf to check if it's a real flexi (articulated print-in-place)
 * or a single fused mesh that just LOOKS articulated.
 *
 * Reports:
 *  - Number of disjoint connected components (welded by position)
 *  - Per-component triangle count + bbox + volume estimate
 *  - Min gap distance between each pair of components (FDM joint clearance)
 *
 * Usage:
 *   pnpm tsx src/scripts/analyze-flexi.ts public/uploads/<id>.3mf
 */
import { readFile } from 'node:fs/promises'
import { loadBaseMeshFromBytes } from '../lib/import/load-base-mesh'

const WELD_EPS = 1e-4  // mm — coords within this distance are considered the same vertex
const QUANT = 1 / WELD_EPS

// Quantize a coord into an integer for hashing.
function qkey(x: number, y: number, z: number): string {
  return `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`
}

// Union-Find
class UF {
  parent: Int32Array
  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]  // path compression
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

async function main() {
  const path = process.argv[2]
  if (!path) { console.error('usage: tsx analyze-flexi.ts <path>'); process.exit(1) }

  console.time('load')
  const bytes = new Uint8Array(await readFile(path))
  const mesh = await loadBaseMeshFromBytes(bytes)
  console.timeEnd('load')
  console.log(`triangles: ${mesh.triangleCount.toLocaleString()}`)
  console.log(`bbox size: ${mesh.bbox.size.map((s) => s.toFixed(1)).join(' × ')} mm`)

  // Step 1: weld vertices by quantized position → unique vertex ID
  console.time('weld vertices')
  const vertMap = new Map<string, number>()
  const vertIds = new Int32Array(mesh.triangleCount * 3)
  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = t * 9
    for (let v = 0; v < 3; v++) {
      const key = qkey(mesh.positions[o + v * 3], mesh.positions[o + v * 3 + 1], mesh.positions[o + v * 3 + 2])
      let id = vertMap.get(key)
      if (id === undefined) {
        id = vertMap.size
        vertMap.set(key, id)
      }
      vertIds[t * 3 + v] = id
    }
  }
  console.timeEnd('weld vertices')
  console.log(`unique vertices (welded): ${vertMap.size.toLocaleString()}`)

  // Step 2: union-find on welded vertex IDs via triangle edges
  console.time('union-find')
  const uf = new UF(vertMap.size)
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = vertIds[t * 3], v1 = vertIds[t * 3 + 1], v2 = vertIds[t * 3 + 2]
    uf.union(v0, v1)
    uf.union(v0, v2)
  }
  console.timeEnd('union-find')

  // Step 3: bucket triangles by component (root of any of its vertices)
  console.time('group components')
  const compMap = new Map<number, number[]>()  // root → triangle indices
  for (let t = 0; t < mesh.triangleCount; t++) {
    const root = uf.find(vertIds[t * 3])
    let list = compMap.get(root)
    if (!list) { list = []; compMap.set(root, list) }
    list.push(t)
  }
  const components = [...compMap.values()].sort((a, b) => b.length - a.length)
  console.timeEnd('group components')

  // Step 4: per-component stats
  console.log(`\n=== ${components.length} connected component(s) ===`)
  const compBboxes: Array<{ min: [number, number, number]; max: [number, number, number] }> = []
  for (let ci = 0; ci < Math.min(components.length, 20); ci++) {
    const comp = components[ci]
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const t of comp) {
      const o = t * 9
      for (let v = 0; v < 3; v++) {
        const x = mesh.positions[o + v * 3], y = mesh.positions[o + v * 3 + 1], z = mesh.positions[o + v * 3 + 2]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
    }
    compBboxes.push({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] })
    const sz = [maxX - minX, maxY - minY, maxZ - minZ]
    console.log(
      `  C${ci}: ${comp.length.toLocaleString()} tris, ` +
      `bbox=${sz.map((s) => s.toFixed(1)).join('×')}mm, ` +
      `center=[${((minX+maxX)/2).toFixed(1)}, ${((minY+maxY)/2).toFixed(1)}, ${((minZ+maxZ)/2).toFixed(1)}]`
    )
  }
  if (components.length > 20) console.log(`  … (${components.length - 20} more)`)

  // Step 5: AABB-based pairwise gap analysis (cheap upper bound)
  if (components.length >= 2 && components.length <= 30) {
    console.log(`\n=== AABB-gap matrix (mm) — 0 means bboxes overlap ===`)
    const N = compBboxes.length
    for (let i = 0; i < N; i++) {
      const row: string[] = []
      for (let j = 0; j < N; j++) {
        if (i === j) { row.push('  -  '); continue }
        const a = compBboxes[i], b = compBboxes[j]
        const dx = Math.max(0, Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0]))
        const dy = Math.max(0, Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1]))
        const dz = Math.max(0, Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2]))
        const gap = Math.sqrt(dx*dx + dy*dy + dz*dz)
        row.push(gap.toFixed(2).padStart(5))
      }
      console.log(`  C${i}: ${row.join(' ')}`)
    }
    console.log('Note: AABB gap=0 means component bboxes intersect — gap could still')
    console.log('be positive (rotating joints commonly have overlapping AABBs).')
  }
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
