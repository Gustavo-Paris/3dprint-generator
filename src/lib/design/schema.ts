/**
 * Design schema — structured representation of "what to build" that an LLM
 * emits from the user's natural-language request + optional logo image.
 *
 * A single generator consumes this schema, removing the brittle keyword-based
 * composer routing. Primitives cover the canonical product shapes (cylinder
 * sleeves, flat plaques, round discs); anything outside that falls into
 * `freeform` and goes through Meshy.
 */
import { z } from 'zod'

export const LogoSpec = z.object({
  /**
   * - `through_cut`: silhouette cut clear through the host (keychain style)
   * - `engraved`:    whole logo silhouette debossed into the host's surface
   * - `embossed`:    whole logo silhouette raised on the host's surface
   */
  treatment: z.enum(['through_cut', 'engraved', 'embossed']),
  /**
   * Which face of the host gets the logo:
   * - `top_face`     — top face of a flat plate / disc
   * - `bottom_face`  — bottom face of a flat plate / disc
   * - `front_face`   — small logo on one side of a cylinder (flat slab cutter)
   * - `wrapped_around` — large logo wrapped cylindrically around the host
   */
  position: z.enum(['top_face', 'bottom_face', 'front_face', 'wrapped_around']),
  /**
   * Logo's largest dim as a fraction of the host's primary face dim.
   * Silently clamped to [0.2, 0.95] — when the LLM iterates "aumenta mais"
   * past the cap, we cap rather than fail.
   */
  sizeRatio: z
    .number()
    .transform((n) => Math.max(0.2, Math.min(0.95, n)))
    .default(0.6),
  /** Engraving / emboss depth in mm. Ignored for through_cut. */
  depthMm: z.number().positive().optional(),
  /**
   * Binarisation threshold for the source image (0-255). Anything darker
   * than this becomes "ink" before potrace traces. Default 230 — good for
   * gradient / light-coloured logos. Lower (150-200) for darker logos;
   * higher (240-250) for ultra-light pastels. Tune via "Editar JSON" if
   * the result is fragmented (too low) or a blob (too high).
   */
  binaryThreshold: z.number().min(50).max(254).optional(),
  /** Extruder mapping for the logo/text graphic. Typically 'B' (highlight/secondary). */
  extruder: z.enum(['A', 'B']).default('B'),
  /**
   * Automatically generate stencil bridges to keep inner islands (like in O, P, A)
   * from falling out when using through_cut.
   */
  addBridges: z.boolean().default(false),
  /** Pattern texture to apply inside/on the logo surface. */
  texture: z.enum(['none', 'honeycomb', 'stripes', 'grid']).default('none'),
})
export type LogoSpec = z.infer<typeof LogoSpec>

const HollowCylinder = z.object({
  kind: z.literal('hollow_cylinder'),
  /** Inside diameter (clearance for the contained object). */
  insideDiameterMm: z.number().positive(),
  heightMm: z.number().positive(),
  wallMm: z.number().positive().default(3),
  baseMm: z.number().positive().default(3),
  /** Mug-style side handle for "alça"/"grip" requests. */
  handle: z
    .object({
      heightMm: z.number().positive().default(60),
      stickOutMm: z.number().positive().default(28),
      thicknessMm: z.number().positive().default(8),
      fingerHoleDiameterMm: z.number().positive().default(22),
    })
    .optional(),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

/** Where to drill a hanging hole on a flat_plate or disc.
 *  - `top` (default) — centered on top edge
 *  - `top_left` / `top_right` — near a top corner
 *  - `left` / `right` — centered on the side edge (vertical midline)
 *  - `bottom` — centered on bottom edge
 *  */
const HangingHolePosition = z.enum([
  'top', 'top_left', 'top_right', 'left', 'right', 'bottom',
])

const FlatPlate = z.object({
  kind: z.literal('flat_plate'),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  thicknessMm: z.number().positive().default(4),
  cornerRadiusMm: z.number().nonnegative().default(2),
  /**
   * Optional; when absent the generator treats it as `'flat'`.
   * - `flat`: widest face on the print bed. Best for chaveiros, magnets,
   *   desk plaques — bed adhesion + clean top face.
   * - `vertical`: stands on its bottom edge (Z = height). Used as the
   *   *top piece* of a Composite trophy or any standing display plate.
   *   Trades print quality (layer lines on the visible face) for the
   *   monumental silhouette.
   */
  orientation: z.enum(['flat', 'vertical']).optional(),
  hangingHole: z
    .object({
      diameterMm: z.number().positive().default(5),
      position: HangingHolePosition.default('top'),
    })
    .optional(),
  /** When set, plate tilts back at this angle from vertical (desk plaque).
   *  Silently clamped to [0, 80] for the same reason as sizeRatio. */
  standAngleDeg: z
    .number()
    .transform((n) => Math.max(0, Math.min(80, n)))
    .optional(),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

const Disc = z.object({
  kind: z.literal('disc'),
  diameterMm: z.number().positive(),
  thicknessMm: z.number().positive().default(5),
  /** Loop ring at the top edge (medal). */
  hangingRing: z
    .object({
      outerDiameterMm: z.number().positive().default(10),
      innerDiameterMm: z.number().positive().default(5),
    })
    .optional(),
  /** Hole drilled near an edge (pendant / keyring). */
  hangingHole: z
    .object({
      diameterMm: z.number().positive().default(4),
      position: HangingHolePosition.default('top'),
    })
    .optional(),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

const Bookmark = z.object({
  kind: z.literal('bookmark'),
  widthMm: z.number().positive().default(25),
  heightMm: z.number().positive().default(140),
  thicknessMm: z.number().positive().default(1.2),
  hangingHole: z
    .object({
      diameterMm: z.number().positive().default(4),
      position: HangingHolePosition.default('bottom'),
    })
    .optional(),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

const Pin = z.object({
  kind: z.literal('pin'),
  diameterMm: z.number().positive().default(25),
  thicknessMm: z.number().positive().default(2),
  pinDiameterMm: z.number().positive().default(4.5),
  pinHeightMm: z.number().positive().default(8),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

const CustomKeychain = z.object({
  kind: z.literal('custom_keychain'),
  thicknessMm: z.number().positive().default(4),
  paddingMm: z.number().positive().default(4),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

const Mug = z.object({
  kind: z.literal('mug'),
  insideDiameterMm: z.number().positive().default(80),
  heightMm: z.number().positive().default(95),
  wallMm: z.number().positive().default(4),
  baseMm: z.number().positive().default(5),
  handleHeightMm: z.number().positive().default(65),
  handleStickOutMm: z.number().positive().default(30),
  handleThicknessMm: z.number().positive().default(10),
  logo: LogoSpec.optional(),
  extruder: z.enum(['A', 'B']).default('A'),
})

/** Single-piece primitives — what a Composite stacks. */
const Primitive = z.discriminatedUnion('kind', [
  HollowCylinder,
  FlatPlate,
  Disc,
  Bookmark,
  Pin,
  CustomKeychain,
  Mug,
])
export type Primitive = z.infer<typeof Primitive>

// ───────────────────────────────────────────────────────────────────
// Imported-mesh edits (user-uploaded .3mf as base geometry)
// ───────────────────────────────────────────────────────────────────

const ScaleOp = z.object({
  op: z.literal('scale'),
  factor: z.union([
    z.number().positive(),
    z.object({ x: z.number().positive(), y: z.number().positive(), z: z.number().positive() }),
  ]),
})

const HoleOp = z.object({
  op: z.literal('hole'),
  faceId: z.number().int().nonnegative(),
  shape: z.enum(['circle', 'rect']).default('circle'),
  diameterMm: z.number().positive().optional(),
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  depthMm: z.union([z.number().positive(), z.literal('through')]).default('through'),
  /** Positions in the face's local 2D coordinate frame (origin = face centroid). */
  positions: z.array(z.tuple([z.number(), z.number()])).min(1),
})

const AddLogoOp = z.object({
  op: z.literal('add_logo'),
  /** Semantic face to place on (LLM path). Optional when an explicit anchor is
   *  given (click-to-place path). */
  faceId: z.number().int().nonnegative().optional(),
  /** Exact placement (click-to-place): world point on the mesh surface + the
   *  local surface normal there, both in mesh/JSCAD space. Overrides faceId —
   *  lands the logo precisely where the user clicked, not at a coarse face
   *  centroid. */
  anchorPoint: z.tuple([z.number(), z.number(), z.number()]).optional(),
  anchorNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),
  // Absolute URL (blob) or relative path (`/uploads/...` in local dev).
  imageUrl: z.string().min(1),
  sizeMm: z.number().positive(),
  depthMm: z.number().positive().default(0.6),
  treatment: z.enum(['embossed', 'engraved', 'through_cut']).default('embossed'),
  /** Optional in-plane offset from the anchor/centroid. */
  offsetMm: z.tuple([z.number(), z.number()]).default([0, 0]),
})

const EmbossTextOp = z.object({
  op: z.literal('emboss_text'),
  faceId: z.number().int().nonnegative(),
  text: z.string().min(1).max(40),
  treatment: z.enum(['embossed', 'engraved']).default('embossed'),
  sizeMm: z.number().positive(),
  depthMm: z.number().positive().default(0.5),
  offsetMm: z.tuple([z.number(), z.number()]).default([0, 0]),
})

const JscadRawOp = z.object({
  op: z.literal('jscad_raw'),
  /** JSCAD module source. Must export `main()` returning a Geom3 to UNION with the
   *  current mesh, or `main(currentMesh)` to receive the current mesh and return
   *  the replacement. */
  code: z.string().min(10).max(20_000),
  mode: z.enum(['union', 'replace']).default('union'),
})

const Op = z.discriminatedUnion('op', [
  ScaleOp, HoleOp, AddLogoOp, EmbossTextOp, JscadRawOp,
])
export type Op = z.infer<typeof Op>

const Imported = z.object({
  kind: z.literal('imported'),
  // Absolute URL (blob) or relative path (`/uploads/...` in local dev).
  baseMeshUrl: z.string().min(1),
  edits: z.array(Op).max(20).default([]),
})

/**
 * Stacks 2-4 primitives along the Z axis. Each part contributes its own
 * grounded geometry; `offsetZ` is the height at which the part's bottom
 * sits (so a 15mm-thick disc at offsetZ=0 followed by a vertical plate at
 * offsetZ=15 makes a trophy: base + standing plaque).
 */
const Composite = z.object({
  kind: z.literal('composite'),
  parts: z
    .array(
      z.object({
        primitive: Primitive,
        offsetZ: z.number().nonnegative(),
        extruder: z.enum(['A', 'B']).default('A'),
      }),
    )
    .min(2)
    .max(4),
})

/**
 * Freeform / organic generation — the escape hatch the parametric primitives
 * can't cover (animals, characters, busts, irregular objects). Routed to Meshy
 * (text-to-3D, or image-to-3D when `sourceImageUrl` is set).
 */
const Freeform = z.object({
  kind: z.literal('freeform'),
  prompt: z.string().min(3).max(600),
  sourceImageUrl: z.string().min(1).optional(),
  targetMaxDimMm: z
    .number()
    .transform((n) => Math.max(20, Math.min(256, n)))
    .optional(),
  artStyle: z.enum(['realistic', 'sculpture']).default('realistic'),
})

export const Design = z.discriminatedUnion('kind', [
  HollowCylinder,
  FlatPlate,
  Disc,
  Composite,
  Bookmark,
  Pin,
  CustomKeychain,
  Mug,
  Imported,
  Freeform,
])
export type Design = z.infer<typeof Design>
/** Input shape — defaults (extruder, addBridges, texture, …) are optional here.
 *  Use this in tests or callers that build a Design literal without filling
 *  every defaulted field. */
export type DesignInput = z.input<typeof Design>
