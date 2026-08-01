import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { applyScale } from './scale'
import { applyHole } from './hole'
import { applyAddLogo } from './add-logo'
import { applyEmbossText } from './emboss-text'
import { applyJscadRaw } from './jscad-raw'
import { applyPaintRegion } from './paint-region'
import { applyPaintFromImage } from './paint-from-image'
import { applyPaintBrush } from './paint-brush'

export interface OpContext {
  faces: SemanticFace[]
  /** Server-resolved uploaded logo/reference image. add_logo + paint_from_image. */
  logoImageBuffer?: Buffer | null
  /** Filled by paint_from_image so the API can seed viewer colour pickers. */
  paintPalette?: { A: string; B: string }
  /** Non-fatal op feedback surfaced to the client (apply-edits wires it per op). */
  warn?: (reason: string) => void
}

export const OPS = {
  scale:            (mesh: BaseMesh, op: Op, _ctx: OpContext) => applyScale(mesh, op as never),
  hole:             (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyHole(mesh, op as never, ctx.faces),
  add_logo:         (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyAddLogo(mesh, op as never, ctx.faces, ctx.logoImageBuffer, ctx.warn),
  emboss_text:      (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyEmbossText(mesh, op as never, ctx.faces),
  jscad_raw:        (mesh: BaseMesh, op: Op, _ctx: OpContext) => applyJscadRaw(mesh, op as never),
  paint_region:     (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyPaintRegion(mesh, op as never, ctx.faces),
  paint_from_image: async (mesh: BaseMesh, op: Op, ctx: OpContext) => {
    const { applyPaintFromImageDetailed } = await import('./paint-from-image')
    const r = await applyPaintFromImageDetailed(
      mesh,
      op as never,
      ctx.faces,
      ctx.logoImageBuffer,
    )
    ctx.paintPalette = r.palette
    return r.mesh
  },
  paint_brush:      (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyPaintBrush(mesh, op as never, ctx.faces),
} as const

export type OpName = keyof typeof OPS
