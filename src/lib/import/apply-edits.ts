import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace, EditWarning } from './types'
import { OPS, type OpName } from './ops'

export interface ApplyEditsResult {
  mesh: BaseMesh
  warnings: EditWarning[]
}

export async function applyEdits(
  baseMesh: BaseMesh,
  edits: Op[],
  faces: SemanticFace[],
): Promise<ApplyEditsResult> {
  let mesh = baseMesh
  const warnings: EditWarning[] = []
  const ctx = { faces }

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    const handler = OPS[edit.op as OpName]
    if (!handler) {
      warnings.push({ opIndex: i, op: edit.op, reason: `unknown op '${edit.op}'` })
      continue
    }
    try {
      mesh = await handler(mesh, edit, ctx)
    } catch (e) {
      warnings.push({ opIndex: i, op: edit.op, reason: (e as Error).message })
      // mesh unchanged; continue with the next op
    }
  }

  return { mesh, warnings }
}
