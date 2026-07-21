import { z } from 'zod'
import { Design } from '@/lib/design/schema'

/**
 * Request body for POST /api/generate.
 *
 * Extracted to a pure module (no `@/auth`/`next/server` in its import chain) so
 * it is unit-testable without mounting the route handler in the vitest node env.
 */

/** Cap each client-captured preview data URL (PNG). Bounds an otherwise
 *  unbounded body (4 × unbounded strings → potential memory DoS). */
const MAX_PREVIEW = 8 * 1024 * 1024

export const Body = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(2000),
  imageUrl: z.string().optional(),
  /** Fresh .3mf upload URL or relative path — triggers the imported-mesh edit branch. */
  meshUrl: z.string().min(1).optional(),
  /** Client-captured 4-angle PNG previews (data URLs) for the first import request. */
  previewDataUrls: z.object({
    top: z.string().max(MAX_PREVIEW),
    front: z.string().max(MAX_PREVIEW),
    right: z.string().max(MAX_PREVIEW),
    iso: z.string().max(MAX_PREVIEW),
  }).optional(),
  /** Bypass the LLM parser. The generator builds straight from this Design
   * (still sanity-clamped). Useful for direct numeric overrides
   * ("sizeRatio EXACTLY 0.85") that natural-language iteration handles
   * poorly. */
  designOverride: Design.optional(),
  /** Click-to-place: an exact point + normal on the imported mesh (mesh space)
   * where the logo should go. Bypasses the LLM and semantic faces entirely. */
  logoPlacement: z.object({
    point: z.tuple([z.number(), z.number(), z.number()]),
    normal: z.tuple([z.number(), z.number(), z.number()]),
    treatment: z.enum(['embossed', 'engraved', 'through_cut']).default('engraved'),
    sizeMm: z.number().positive().max(200).default(40),
    depthMm: z.number().positive().max(20).default(1.6),
  }).optional(),
  /** Click-to-paint multi-colour: radius brush or flood-fill closed region. */
  paintPlacement: z.object({
    point: z.tuple([z.number(), z.number(), z.number()]),
    extruder: z.enum(['A', 'B']).default('B'),
    mode: z.enum(['radius', 'fill']).default('radius'),
    radiusMm: z.number().positive().default(14),
    featureAngleDeg: z.number().positive().max(90).default(38),
  }).optional(),
})
