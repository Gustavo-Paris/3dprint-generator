import { z } from 'zod'
import { Design } from '@/lib/design/schema'
import type { SemanticFace } from '@/lib/import/types'
import type { PreviewBundle } from '@/lib/design/parse-import'

/**
 * The shape stored in iterations.validation_report (jsonb): a built Design,
 * plus — for the imported-mesh flow — the cached semantic faces and 4-angle
 * previews so subsequent iterations skip re-segmentation. Flexify rows store
 * `{ kind: 'flexified', ... }` which is NOT a Design member; readers tolerate
 * a parse miss (returns null) rather than throwing.
 */
export const CachedDesign = Design.and(
  z.object({
    _faces: z.array(z.unknown()).optional(),
    _previews: z.unknown().optional(),
  }),
)

export type CachedDesign = z.infer<typeof CachedDesign> & {
  _faces?: SemanticFace[]
  _previews?: PreviewBundle
}

/** Parse a raw jsonb value into a typed cached design, or null if it isn't one
 *  (legacy row, flexified row, malformed). Never throws. */
export function readCachedDesign(raw: unknown): CachedDesign | null {
  const r = CachedDesign.safeParse(raw)
  return r.success ? (r.data as CachedDesign) : null
}
