/**
 * One-shot stress test: how long does JSCAD's booleans.union take on a real
 * imported mesh? Usage:
 *   pnpm tsx src/scripts/stress-boolean.ts public/uploads/<id>.3mf
 */
import { readFile } from 'node:fs/promises'
import { loadBaseMeshFromBytes } from '../lib/import/load-base-mesh'
import { segmentFaces } from '../lib/import/face-segment'
import { baseMeshToGeom3 } from '../lib/import/ops/_shared'
import * as jscadNs from '@jscad/modeling'

type JscadShape = typeof import('@jscad/modeling')
const jscad: JscadShape =
  ((jscadNs as unknown as { default?: JscadShape }).default ?? (jscadNs as unknown as JscadShape))

async function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: pnpm tsx src/scripts/stress-boolean.ts <path-to-3mf>')
    process.exit(1)
  }

  const bytes = new Uint8Array(await readFile(path))
  console.log('file:', bytes.length, 'bytes')

  console.time('parse')
  const mesh = await loadBaseMeshFromBytes(bytes)
  console.timeEnd('parse')
  console.log('triangles:', mesh.triangleCount)

  console.time('segment')
  segmentFaces(mesh)
  console.timeEnd('segment')

  console.time('baseMeshToGeom3')
  const baseGeom = await baseMeshToGeom3(mesh)
  console.timeEnd('baseMeshToGeom3')

  // Overlapping cuboid at the mesh's bbox center — forces real CSG work.
  const c = mesh.bbox.center
  const overlapping = jscad.transforms.translate([c[0], c[1], c[2]],
    jscad.primitives.cuboid({ size: [40, 40, 10] }))

  console.log('booleans.union starting (mesh vs OVERLAPPING cuboid 40x40x10 at center)...')
  console.time('booleans.union')
  jscad.booleans.union(baseGeom, overlapping)
  console.timeEnd('booleans.union')
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
