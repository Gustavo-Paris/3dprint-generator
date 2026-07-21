import { readFileSync, writeFileSync } from 'fs'
import { loadBaseMeshFromBytes } from '../src/lib/import/load-base-mesh'
import { applyPaintBrush } from '../src/lib/import/ops/paint-brush'
import { serialize3mf } from '../src/lib/3mf/serialize-3mf'

async function main() {
  const tLoad = Date.now()
  const mesh = await loadBaseMeshFromBytes(
    new Uint8Array(readFileSync('public/meshes/f4a00256-34a9-4432-a296-4248560b8939.3mf')),
  )
  console.log('load ms', Date.now() - tLoad, 'tris', mesh.triangleCount)

  const tPaint = Date.now()
  const painted = await applyPaintBrush(
    mesh,
    {
      op: 'paint_brush',
      point: [0, -30, 40],
      extruder: 'B',
      mode: 'fill',
      featureAngleDeg: 38,
      radiusMm: 14,
    },
    [],
  )
  console.log('paint ms', Date.now() - tPaint, 'nB', painted.extruders.filter((e) => e === 'B').length)

  const tSer = Date.now()
  const bodies = (['A', 'B'] as const)
    .map((ex) => {
      const out: number[] = []
      for (let i = 0; i < painted.triangleCount; i++) {
        if (painted.extruders[i] !== ex) continue
        const o = i * 9
        for (let j = 0; j < 9; j++) out.push(painted.positions[o + j])
      }
      return { positions: new Float32Array(out), extruder: ex, label: ex }
    })
    .filter((b) => b.positions.length > 0)
  // faster filter:
  const tFilter = Date.now()
  // use typed filter like generate
  function filter(ex: 'A' | 'B') {
    let count = 0
    for (let i = 0; i < painted.triangleCount; i++) if (painted.extruders[i] === ex) count++
    const pos = new Float32Array(count * 9)
    let w = 0
    for (let i = 0; i < painted.triangleCount; i++) {
      if (painted.extruders[i] !== ex) continue
      const o = i * 9
      for (let j = 0; j < 9; j++) pos[w++] = painted.positions[o + j]
    }
    return pos
  }
  const bodies2 = (['A', 'B'] as const)
    .map((ex) => ({ positions: filter(ex), extruder: ex, label: ex }))
    .filter((b) => b.positions.length > 0)
  console.log('filter ms', Date.now() - tFilter)

  const tS = Date.now()
  const bytes = serialize3mf(bodies2)
  console.log('serialize ms', Date.now() - tS, 'bytes', bytes.length)
  console.log('total ms', Date.now() - tLoad)
}
main()
