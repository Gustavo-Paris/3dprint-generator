import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'
import { applyScale } from './scale'
import { applyHole } from './hole'
import { applyAddLogo } from './add-logo'
import { applyEmbossText } from './emboss-text'
import { applyJscadRaw } from './jscad-raw'

export interface OpContext {
  faces: SemanticFace[]
}

export const OPS = {
  scale:       (mesh: BaseMesh, op: Op, _ctx: OpContext) => applyScale(mesh, op as never),
  hole:        (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyHole(mesh, op as never, ctx.faces),
  add_logo:    (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyAddLogo(mesh, op as never, ctx.faces),
  emboss_text: (mesh: BaseMesh, op: Op, ctx: OpContext)  => applyEmbossText(mesh, op as never, ctx.faces),
  jscad_raw:   (mesh: BaseMesh, op: Op, _ctx: OpContext) => applyJscadRaw(mesh, op as never),
} as const

export type OpName = keyof typeof OPS
