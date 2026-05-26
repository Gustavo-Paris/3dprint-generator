import type { Op } from '@/lib/design/schema'
import type { BaseMesh } from '../types'
import { recomputeMeshDerived } from './_shared'

type ScaleParams = Extract<Op, { op: 'scale' }>

export async function applyScale(mesh: BaseMesh, op: ScaleParams): Promise<BaseMesh> {
  const f = op.factor
  const sx = typeof f === 'number' ? f : f.x
  const sy = typeof f === 'number' ? f : f.y
  const sz = typeof f === 'number' ? f : f.z

  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i]     = mesh.positions[i]     * sx
    positions[i + 1] = mesh.positions[i + 1] * sy
    positions[i + 2] = mesh.positions[i + 2] * sz
  }
  return recomputeMeshDerived({ ...mesh, positions })
}
