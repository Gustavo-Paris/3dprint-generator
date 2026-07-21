import { readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { loadBaseMeshFromBytes } from '../src/lib/import/load-base-mesh'
import { applyPaintFromImageDetailed } from '../src/lib/import/ops/paint-from-image'
import { serialize3mf } from '../src/lib/3mf/serialize-3mf'

async function main() {
  const mesh = await loadBaseMeshFromBytes(
    new Uint8Array(readFileSync('public/uploads/fd581f49-c57a-469d-91b5-703c61e50cd0.3mf')),
  )
  const img = readFileSync('public/uploads/38e14923-42a7-4625-90c7-e3c8e53441d1.png')
  const t0 = Date.now()
  const r = await applyPaintFromImageDetailed(
    mesh,
    { op: 'paint_from_image', view: 'front' },
    [],
    img,
  )
  const nB = r.mesh.extruders.filter((e) => e === 'B').length
  let faceB = 0, faceN = 0, bodyB = 0, bodyN = 0
  for (let i = 0; i < r.mesh.triangleCount; i++) {
    const o = i * 9
    const z = (r.mesh.positions[o + 2] + r.mesh.positions[o + 5] + r.mesh.positions[o + 8]) / 3
    const x = (r.mesh.positions[o] + r.mesh.positions[o + 3] + r.mesh.positions[o + 6]) / 3
    const mz = (z - mesh.bbox.min[2]) / mesh.bbox.size[2]
    const mx = (x - mesh.bbox.min[0]) / mesh.bbox.size[0]
    const inFace = mz > 0.48 && mz < 0.93 && mx > 0.25 && mx < 0.75
    if (inFace) {
      faceN++
      if (r.mesh.extruders[i] === 'B') faceB++
    } else {
      bodyN++
      if (r.mesh.extruders[i] === 'B') bodyB++
    }
  }
  console.log(
    JSON.stringify({
      ms: Date.now() - t0,
      pctB: +(100 * nB / r.mesh.extruders.length).toFixed(1),
      faceplateB: +(100 * faceB / faceN).toFixed(1),
      bodyB: +(100 * bodyB / bodyN).toFixed(1),
      palette: r.palette,
    }),
  )
  const bodies = (['A', 'B'] as const)
    .map((ex) => {
      const out: number[] = []
      for (let i = 0; i < r.mesh.triangleCount; i++) {
        if (r.mesh.extruders[i] !== ex) continue
        const o = i * 9
        for (let j = 0; j < 9; j++) out.push(r.mesh.positions[o + j])
      }
      return { positions: new Float32Array(out), extruder: ex, label: ex }
    })
    .filter((b) => b.positions.length > 0)
  const bytes = serialize3mf(bodies)
  const uid = randomUUID()
  writeFileSync(`public/meshes/${uid}.3mf`, bytes)
  const report = {
    kind: 'imported',
    baseMeshUrl: '/uploads/fd581f49-c57a-469d-91b5-703c61e50cd0.3mf',
    edits: [{ op: 'paint_from_image', view: 'front' }],
    _paintPalette: r.palette,
  }
  writeFileSync(
    '/tmp/paint-v3.sql',
    `INSERT INTO iterations (id, project_id, user_message, status, strategy, mesh_blob_url, validation_report)
VALUES (
  '${uid}',
  '70a239e8-61a8-4fc8-bd59-b547a61c7878',
  'pintar com a imagem (faceplate + alinhamento)',
  'ready',
  'imported',
  '/meshes/${uid}.3mf',
  '${JSON.stringify(report).replace(/'/g, "''")}'::jsonb
);
UPDATE projects SET current_iteration_id = '${uid}', updated_at = now()
WHERE id = '70a239e8-61a8-4fc8-bd59-b547a61c7878';
`,
  )
  console.log('uid', uid)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
