import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as jscad from '@jscad/modeling'
import { serialize3mf } from '../../src/lib/3mf/serialize-3mf'

const cube = jscad.primitives.cube({ size: 30 })
const polys = jscad.geometries.geom3.toPolygons(cube)
const positions: number[] = []
for (const p of polys) {
  const v = p.vertices
  // Fan-triangulate polygon (may have > 3 vertices)
  for (let i = 1; i < v.length - 1; i++) {
    positions.push(...v[0], ...v[i], ...v[i + 1])
  }
}
const bytes = serialize3mf([{
  positions: new Float32Array(positions),
  extruder: 'A',
  label: 'Cube',
}])
writeFileSync(join(__dirname, 'cube-30mm.3mf'), bytes)
console.log('Wrote cube-30mm.3mf', bytes.length, 'bytes,', positions.length / 9, 'triangles')
