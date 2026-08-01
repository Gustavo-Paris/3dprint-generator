import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace, EditWarning } from './types'
import { OPS, type OpName } from './ops'

export interface ApplyEditsResult {
  mesh: BaseMesh
  warnings: EditWarning[]
  /** Hex colours sampled from paint_from_image (for viewer pickers). */
  paintPalette?: { A: string; B: string }
}

/** Ops above this triangle count blow JSCAD's heap when they trigger CSG.
 *  Measured experimentally — JSCAD uses BSP trees that scale poorly past
 *  ~50k triangles. Real-world sculpted .3mf models routinely have 500k–2M
 *  triangles; for those, this backend can't help (yet — Manifold3D would).
 *  Scale-only edits skip the cap since they're vertex-only and cheap. */
export const BOOLEAN_TRIANGLE_LIMIT = 50_000

/** Ops that perform CSG through JSCAD's BSP path and therefore can't run on
 *  large meshes. `scale` is excluded (vertex-only). `add_logo` is excluded too:
 *  it self-routes — embossed appends a separate body (no boolean), engraved /
 *  through_cut use the Manifold backend (handles millions of triangles).
 *  paint_* ops only relabel extruders (no CSG). */
const CSG_OPS = new Set<string>(['hole', 'emboss_text', 'jscad_raw'])

export async function applyEdits(
  baseMesh: BaseMesh,
  edits: Op[],
  faces: SemanticFace[],
  logoImageBuffer?: Buffer | null,
): Promise<ApplyEditsResult> {
  let mesh = baseMesh
  const warnings: EditWarning[] = []
  const ctx: {
    faces: SemanticFace[]
    logoImageBuffer?: Buffer | null
    paintPalette?: { A: string; B: string }
    warn?: (reason: string) => void
  } = { faces, logoImageBuffer }

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    const handler = OPS[edit.op as OpName]
    if (!handler) {
      warnings.push({ opIndex: i, op: edit.op, reason: `unknown op '${edit.op}'` })
      continue
    }
    if (CSG_OPS.has(edit.op) && mesh.triangleCount > BOOLEAN_TRIANGLE_LIMIT) {
      warnings.push({
        opIndex: i,
        op: edit.op,
        reason:
          `mesh has ${mesh.triangleCount.toLocaleString()} triangles ` +
          `(>${BOOLEAN_TRIANGLE_LIMIT.toLocaleString()} limit); JSCAD boolean ops ` +
          `would OOM. Use a smaller / simpler model, or wait for Manifold3D backend.`,
      })
      continue
    }
    try {
      ctx.warn = (reason: string) => warnings.push({ opIndex: i, op: edit.op, reason })
      mesh = await handler(mesh, edit, ctx)
    } catch (e) {
      warnings.push({ opIndex: i, op: edit.op, reason: (e as Error).message })
      // mesh unchanged; continue with the next op
    }
  }

  return { mesh, warnings, paintPalette: ctx.paintPalette }
}
