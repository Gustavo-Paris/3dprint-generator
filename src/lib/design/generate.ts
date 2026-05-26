/**
 * Single parametric generator. Consumes a Design (structured spec from the
 * LLM) and produces a print-ready STL via JSCAD primitives — fully
 * deterministic, zero external service cost.
 *
 * Primitives: hollow_cylinder, flat_plate, disc. Anything exotic the user
 * describes must collapse into one of these three (the LLM is instructed
 * to pick the closest primitive — there is no freeform escape hatch).
 */
import * as jscadNs from '@jscad/modeling'
import sharp from 'sharp'
import type { Geom3 } from '@jscad/modeling/src/geometries/geom3'
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import { serializeBinarySTL } from '@/lib/stl/serialize'
import type { Design, LogoSpec } from './schema'

/** Width / height ratio of the source image. Falls back to 1 (square) on failure. */
export async function readImageAspectRatio(buffer: Buffer): Promise<number> {
  try {
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) return 1
    return meta.width / meta.height
  } catch {
    return 1
  }
}

type JscadShape = {
  primitives: typeof import('@jscad/modeling').primitives
  booleans: typeof import('@jscad/modeling').booleans
  geometries: typeof import('@jscad/modeling').geometries
  transforms: typeof import('@jscad/modeling').transforms
  expansions: typeof import('@jscad/modeling').expansions
  extrusions: typeof import('@jscad/modeling').extrusions
}
const jscad: JscadShape =
  ((jscadNs as unknown as { default?: JscadShape }).default ??
    (jscadNs as unknown as JscadShape))
const { primitives, booleans, geometries, transforms, expansions, extrusions } = jscad

export interface GenerateContext {
  logoImageBuffer: Buffer | null
}

export interface MeshBody {
  positions: Float32Array
  extruder: 'A' | 'B'
  label: string
}

export interface GenerateResult {
  stl: Uint8Array
  bodies: MeshBody[]
  meta: {
    kind: Design['kind']
    bboxMm: { x: number; y: number; z: number }
  }
}

interface InternalBuildResult {
  bodies: MeshBody[]
  meta: {
    kind: Design['kind']
    bboxMm: { x: number; y: number; z: number }
  }
}

export async function generateFromDesign(
  design: Design,
  ctx: GenerateContext,
): Promise<GenerateResult> {
  let result: InternalBuildResult
  switch (design.kind) {
    case 'hollow_cylinder': result = await buildHollowCylinder(design, ctx); break
    case 'flat_plate':      result = await buildFlatPlate(design, ctx); break
    case 'disc':            result = await buildDisc(design, ctx); break
    case 'composite':       result = await buildComposite(design, ctx); break
    case 'bookmark':        result = await buildBookmark(design, ctx); break
    case 'pin':             result = await buildPin(design, ctx); break
    case 'custom_keychain': result = await buildCustomKeychain(design, ctx); break
    case 'mug':             result = await buildMug(design, ctx); break
  }

  // Merge all bodies' positions to generate the fallback single STL
  const totalLength = result.bodies.reduce((sum, b) => sum + b.positions.length, 0)
  const mergedPositions = new Float32Array(totalLength)
  let offset = 0
  for (const body of result.bodies) {
    mergedPositions.set(body.positions, offset)
    offset += body.positions.length
  }
  const stl = serializeBinarySTL(Array.from(mergedPositions))

  return {
    stl,
    bodies: result.bodies,
    meta: result.meta,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// hollow_cylinder
// ────────────────────────────────────────────────────────────────────────────

async function buildHollowCylinder(
  d: Extract<Design, { kind: 'hollow_cylinder' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const insideR = d.insideDiameterMm / 2
  const outsideR = insideR + d.wallMm
  const height = d.heightMm
  const base = d.baseMm

  // Outer cylinder, base at z=0.
  const outer = transforms.translate(
    [0, 0, height / 2],
    primitives.cylinder({ radius: outsideR, height, segments: 96 }),
  )
  // Inner cylinder lifted by base thickness; +1mm overshoot at top for clean rim.
  const innerH = height - base + 1
  const inner = transforms.translate(
    [0, 0, base + innerH / 2],
    primitives.cylinder({ radius: insideR, height: innerH, segments: 96 }),
  )
  let cup: Geom3 = booleans.subtract(outer, inner) as Geom3

  // Optional mug-style side handle
  if (d.handle) {
    const h = d.handle
    const overlap = 1
    const barT = h.thicknessMm
    const handleTopZ = height / 2 + h.heightMm / 2
    const handleBotZ = height / 2 - h.heightMm / 2
    const outerX = outsideR + h.stickOutMm
    const horizLen = h.stickOutMm + overlap
    const horizCx = (outsideR - overlap + outerX) / 2

    const topBar = transforms.translate(
      [horizCx, 0, handleTopZ],
      primitives.cuboid({ size: [horizLen, barT, barT] }),
    )
    const botBar = transforms.translate(
      [horizCx, 0, handleBotZ],
      primitives.cuboid({ size: [horizLen, barT, barT] }),
    )
    const outerBar = transforms.translate(
      [outerX, 0, height / 2],
      primitives.cuboid({ size: [barT, barT, h.heightMm + barT] }),
    )
    const handle = booleans.union(topBar, outerBar, botBar) as Geom3
    cup = booleans.union(cup, handle) as Geom3
  }

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyCylinderLogo(cup, d, ctx.logoImageBuffer)
    cup = res.solid
    logo = res.logo
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(cup),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'hollow_cylinder',
      bboxMm: { x: outsideR * 2, y: outsideR * 2, z: height },
    },
  }
}

async function applyCylinderLogo(
  cup: Geom3,
  d: Extract<Design, { kind: 'hollow_cylinder' | 'mug' }>,
  imageBuffer: Buffer,
): Promise<{ solid: Geom3; logo?: Geom3 }> {
  if (!d.logo) return { solid: cup }
  const insideR = d.insideDiameterMm / 2
  const outsideR = insideR + d.wallMm
  const targetMaxDim = d.insideDiameterMm * d.logo.sizeRatio
  const overshoot = 0.5 // mm — generous for robust CSG

  const engraveDepth = d.logo.depthMm ?? 1.5
  const embossDepth = d.logo.depthMm ?? 2
  const slabT =
    d.logo.treatment === 'through_cut' ? d.wallMm + overshoot * 2
    : d.logo.treatment === 'embossed'  ? embossDepth + overshoot
    : /* engraved */                     engraveDepth + overshoot

  const logo = await extrudeLogo({
    imageBuffer,
    targetMaxDim,
    depthMm: slabT,
    ignoreHolesSmallerThan: 0,
    binaryThreshold: d.logo.binaryThreshold,
    addBridges: d.logo.addBridges,
    texture: d.logo.texture,
  })

  const zCenterOffset = d.heightMm / 2

  const wrapR =
    d.logo.treatment === 'through_cut' ? (insideR + outsideR) / 2
    : d.logo.treatment === 'embossed'  ? outsideR - overshoot + slabT / 2
    : /* engraved */                     outsideR + overshoot / 2 - slabT / 2

  const logoSpec = d.logo
  const logoGeom3 = transformGeom3Vertices(logo.geom3, (v) => {
    return logoSpec.position === 'wrapped_around'
      ? wrapVertexCylindrically(v, wrapR, zCenterOffset)
      : placeVertexFlat(v, wrapR, zCenterOffset)
  })

  if (d.logo.treatment === 'embossed') {
    return { solid: cup, logo: logoGeom3 }
  }
  if (d.logo.treatment === 'engraved') {
    const pocketSolid = booleans.subtract(cup, logoGeom3) as Geom3
    const inlay = booleans.intersect(cup, logoGeom3) as Geom3
    return { solid: pocketSolid, logo: inlay }
  }
  return { solid: booleans.subtract(cup, logoGeom3) as Geom3 }
}

// ────────────────────────────────────────────────────────────────────────────
// flat_plate
// ────────────────────────────────────────────────────────────────────────────

async function buildFlatPlate(
  d: Extract<Design, { kind: 'flat_plate' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  if (d.orientation === 'vertical') {
    return buildVerticalFlatPlate(d, ctx)
  }
  const plate = primitives.roundedCuboid({
    size: [d.widthMm, d.heightMm, d.thicknessMm],
    roundRadius: Math.min(d.cornerRadiusMm, Math.min(d.widthMm, d.heightMm, d.thicknessMm) / 2 - 0.1),
    segments: 24,
  })

  let solid: Geom3 = plate as Geom3

  if (d.hangingHole) {
    const r = d.hangingHole.diameterMm / 2
    const edgePad = Math.max(r * 1.5, 5)
    const halfW = d.widthMm / 2
    const halfH = d.heightMm / 2
    const pos = d.hangingHole.position
    const xy = (() => {
      switch (pos) {
        case 'top':        return [0,                  halfH - edgePad] as const
        case 'top_left':   return [-(halfW - edgePad), halfH - edgePad] as const
        case 'top_right':  return [ halfW - edgePad,   halfH - edgePad] as const
        case 'left':       return [-(halfW - edgePad), 0]                as const
        case 'right':      return [ halfW - edgePad,   0]                as const
        case 'bottom':     return [0,                 -(halfH - edgePad)] as const
      }
    })()
    const hole = transforms.translate(
      [xy[0], xy[1], 0],
      primitives.cylinder({
        radius: r,
        height: d.thicknessMm + 1,
        segments: 32,
      }),
    )
    solid = booleans.subtract(solid, hole) as Geom3
  }

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyFlatLogo(solid, d, ctx.logoImageBuffer)
    solid = res.solid
    logo = res.logo
  }

  // Ground: shift so the bottom face sits at z=0 (print bed).
  const shiftZ = d.thicknessMm / 2
  solid = transforms.translate([0, 0, shiftZ], solid) as Geom3
  if (logo) {
    logo = transforms.translate([0, 0, shiftZ], logo) as Geom3
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(solid),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'flat_plate',
      bboxMm: { x: d.widthMm, y: d.heightMm, z: d.thicknessMm },
    },
  }
}

async function applyFlatLogo(
  solid: Geom3,
  d: Extract<Design, { kind: 'flat_plate' }>,
  imageBuffer: Buffer,
): Promise<{ solid: Geom3; logo?: Geom3 }> {
  if (!d.logo) return { solid }
  const overshoot = 0.5
  const engraveDepth = d.logo.depthMm ?? 1.5
  const embossDepth = d.logo.depthMm ?? 2

  const imgAspect = await readImageAspectRatio(imageBuffer)
  const availW = d.widthMm * d.logo.sizeRatio
  const availH = d.heightMm * d.logo.sizeRatio
  const widthBound = { w: availW,            h: availW / imgAspect }
  const heightBound = { w: availH * imgAspect, h: availH }
  const fit = (widthBound.h <= availH) ? widthBound : heightBound
  const targetMaxDim = Math.max(fit.w, fit.h)

  const slabT =
    d.logo.treatment === 'through_cut' ? d.thicknessMm + overshoot * 2
    : d.logo.treatment === 'embossed'  ? embossDepth + overshoot
    : /* engraved */                     engraveDepth + overshoot

  const logo = await extrudeLogo({
    imageBuffer,
    targetMaxDim,
    depthMm: slabT,
    ignoreHolesSmallerThan: 0,
    binaryThreshold: d.logo.binaryThreshold,
    addBridges: d.logo.addBridges,
    texture: d.logo.texture,
  })

  const logoGeom3 = alignFlatLogoGeom3(logo.geom3, d.thicknessMm, d.logo, slabT, overshoot)
  if (d.logo.treatment === 'embossed') {
    return { solid, logo: logoGeom3 }
  }
  if (d.logo.treatment === 'engraved') {
    const pocketSolid = booleans.subtract(solid, logoGeom3) as Geom3
    const inlay = booleans.intersect(solid, logoGeom3) as Geom3
    return { solid: pocketSolid, logo: inlay }
  }
  return { solid: booleans.subtract(solid, logoGeom3) as Geom3 }
}

async function buildBookmark(
  d: Extract<Design, { kind: 'bookmark' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const plate = primitives.roundedCuboid({
    size: [d.widthMm, d.heightMm, d.thicknessMm],
    roundRadius: Math.min(2, Math.min(d.widthMm, d.heightMm, d.thicknessMm) / 2 - 0.1),
    segments: 24,
  })

  let solid: Geom3 = plate as Geom3

  if (d.hangingHole) {
    const r = d.hangingHole.diameterMm / 2
    const edgePad = Math.max(r * 1.5, 4)
    const halfW = d.widthMm / 2
    const halfH = d.heightMm / 2
    const pos = d.hangingHole.position
    const xy = (() => {
      switch (pos) {
        case 'top':        return [0,                  halfH - edgePad] as const
        case 'top_left':   return [-(halfW - edgePad), halfH - edgePad] as const
        case 'top_right':  return [ halfW - edgePad,   halfH - edgePad] as const
        case 'left':       return [-(halfW - edgePad), 0]                as const
        case 'right':      return [ halfW - edgePad,   0]                as const
        case 'bottom':     return [0,                 -(halfH - edgePad)] as const
      }
    })()
    const hole = transforms.translate(
      [xy[0], xy[1], 0],
      primitives.cylinder({
        radius: r,
        height: d.thicknessMm + 1,
        segments: 32,
      }),
    )
    solid = booleans.subtract(solid, hole) as Geom3
  }

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyBookmarkLogo(solid, d, ctx.logoImageBuffer)
    solid = res.solid
    logo = res.logo
  }

  // Ground: shift so the bottom face sits at z=0 (print bed).
  const shiftZ = d.thicknessMm / 2
  solid = transforms.translate([0, 0, shiftZ], solid) as Geom3
  if (logo) {
    logo = transforms.translate([0, 0, shiftZ], logo) as Geom3
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(solid),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'bookmark',
      bboxMm: { x: d.widthMm, y: d.heightMm, z: d.thicknessMm },
    },
  }
}

async function applyBookmarkLogo(
  solid: Geom3,
  d: Extract<Design, { kind: 'bookmark' }>,
  imageBuffer: Buffer,
): Promise<{ solid: Geom3; logo?: Geom3 }> {
  if (!d.logo) return { solid }
  const overshoot = 0.5
  const engraveDepth = d.logo.depthMm ?? 0.6
  const embossDepth = d.logo.depthMm ?? 0.6

  const imgAspect = await readImageAspectRatio(imageBuffer)
  const targetMaxDim = d.widthMm * d.logo.sizeRatio
  const logoHeight = targetMaxDim / imgAspect

  const slabT =
    d.logo.treatment === 'through_cut' ? d.thicknessMm + overshoot * 2
    : d.logo.treatment === 'embossed'  ? embossDepth + overshoot
    : /* engraved */                     engraveDepth + overshoot

  const logo = await extrudeLogo({
    imageBuffer,
    targetMaxDim,
    depthMm: slabT,
    ignoreHolesSmallerThan: 0,
    binaryThreshold: d.logo.binaryThreshold,
    addBridges: d.logo.addBridges,
    texture: d.logo.texture,
  })

  const topZ = d.thicknessMm / 2
  const dzMid =
    d.logo.treatment === 'through_cut' ? 0
    : d.logo.treatment === 'embossed'  ? topZ - overshoot + slabT / 2
    : /* engraved */                     topZ + overshoot / 2 - slabT / 2

  const padding = Math.max(d.widthMm * 0.2, 5)
  const yOffset = d.heightMm / 2 - logoHeight / 2 - padding

  let logoGeom3 = alignFlatLogoGeom3(logo.geom3, d.thicknessMm, d.logo, slabT, overshoot)
  logoGeom3 = transforms.translate([0, yOffset, 0], logoGeom3) as Geom3

  if (d.logo.treatment === 'embossed') {
    return { solid, logo: logoGeom3 }
  }
  if (d.logo.treatment === 'engraved') {
    const pocketSolid = booleans.subtract(solid, logoGeom3) as Geom3
    const inlay = booleans.intersect(solid, logoGeom3) as Geom3
    return { solid: pocketSolid, logo: inlay }
  }
  return { solid: booleans.subtract(solid, logoGeom3) as Geom3 }
}

async function buildVerticalFlatPlate(
  d: Extract<Design, { kind: 'flat_plate' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const plate = primitives.roundedCuboid({
    size: [d.widthMm, d.thicknessMm, d.heightMm],
    roundRadius: Math.min(d.cornerRadiusMm, Math.min(d.widthMm, d.heightMm, d.thicknessMm) / 2 - 0.1),
    segments: 24,
  })
  let solid: Geom3 = plate as Geom3

  if (d.hangingHole) {
    const r = d.hangingHole.diameterMm / 2
    const edgePad = Math.max(r * 1.5, 5)
    const halfW = d.widthMm / 2
    const halfH = d.heightMm / 2
    const pos = d.hangingHole.position
    const xz = (() => {
      switch (pos) {
        case 'top':        return [0,                  halfH - edgePad] as const
        case 'top_left':   return [-(halfW - edgePad), halfH - edgePad] as const
        case 'top_right':  return [ halfW - edgePad,   halfH - edgePad] as const
        case 'left':       return [-(halfW - edgePad), 0]                as const
        case 'right':      return [ halfW - edgePad,   0]                as const
        case 'bottom':     return [0,                 -(halfH - edgePad)] as const
      }
    })()
    const hole = transforms.translate(
      [xz[0], 0, xz[1]],
      transforms.rotateX(Math.PI / 2, primitives.cylinder({
        radius: r, height: d.thicknessMm + 1, segments: 32,
      })),
    )
    solid = booleans.subtract(solid, hole) as Geom3
  }

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyVerticalPlateLogo(solid, d, ctx.logoImageBuffer)
    solid = res.solid
    logo = res.logo
  }

  // Ground: bottom edge sits at Z=0.
  const shiftZ = d.heightMm / 2
  solid = transforms.translate([0, 0, shiftZ], solid) as Geom3
  if (logo) {
    logo = transforms.translate([0, 0, shiftZ], logo) as Geom3
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(solid),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'flat_plate',
      bboxMm: { x: d.widthMm, y: d.thicknessMm, z: d.heightMm },
    },
  }
}

async function applyVerticalPlateLogo(
  solid: Geom3,
  d: Extract<Design, { kind: 'flat_plate' }>,
  imageBuffer: Buffer,
): Promise<{ solid: Geom3; logo?: Geom3 }> {
  if (!d.logo) return { solid }
  const overshoot = 0.5
  const engraveDepth = d.logo.depthMm ?? 1.5
  const embossDepth = d.logo.depthMm ?? 2

  const imgAspect = await readImageAspectRatio(imageBuffer)
  const availW = d.widthMm * d.logo.sizeRatio
  const availH = d.heightMm * d.logo.sizeRatio
  const widthBound = { w: availW,            h: availW / imgAspect }
  const heightBound = { w: availH * imgAspect, h: availH }
  const fit = (widthBound.h <= availH) ? widthBound : heightBound
  const targetMaxDim = Math.max(fit.w, fit.h)

  const slabT =
    d.logo.treatment === 'through_cut' ? d.thicknessMm + overshoot * 2
    : d.logo.treatment === 'embossed'  ? embossDepth + overshoot
    : /* engraved */                     engraveDepth + overshoot

  const logo = await extrudeLogo({
    imageBuffer,
    targetMaxDim,
    depthMm: slabT,
    ignoreHolesSmallerThan: 0,
    binaryThreshold: d.logo.binaryThreshold,
    addBridges: d.logo.addBridges,
    texture: d.logo.texture,
  })

  const topYAtPlate = d.thicknessMm / 2
  const isBottom = d.logo.position === 'bottom_face'
  const yFace = isBottom ? -topYAtPlate : topYAtPlate
  const dyMid =
    d.logo.treatment === 'through_cut' ? 0
    : d.logo.treatment === 'embossed'
      ? (isBottom ? yFace + overshoot - slabT / 2 : yFace - overshoot + slabT / 2)
      : /* engraved */
        (isBottom ? yFace - overshoot / 2 + slabT / 2 : yFace + overshoot / 2 - slabT / 2)

  let logoGeom3 = logo.geom3
  if (isBottom) {
    logoGeom3 = transforms.mirrorY(logoGeom3) as Geom3
  }
  logoGeom3 = transforms.translate([0, dyMid, 0], logoGeom3) as Geom3

  if (d.logo.treatment === 'embossed') {
    return { solid, logo: logoGeom3 }
  }
  if (d.logo.treatment === 'engraved') {
    const pocketSolid = booleans.subtract(solid, logoGeom3) as unknown as Geom3
    const inlay = booleans.intersect(solid, logoGeom3) as unknown as Geom3
    return { solid: pocketSolid, logo: inlay }
  }
  return { solid: booleans.subtract(solid, logoGeom3) as unknown as Geom3 }
}

// ────────────────────────────────────────────────────────────────────────────
// disc
// ────────────────────────────────────────────────────────────────────────────

async function buildDisc(
  d: Extract<Design, { kind: 'disc' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const r = d.diameterMm / 2
  let solid: Geom3 = primitives.cylinder({
    radius: r,
    height: d.thicknessMm,
    segments: 96,
  }) as Geom3

  // Hanging ring (medal)
  if (d.hangingRing) {
    const ringR = d.hangingRing.outerDiameterMm / 2
    const ringHoleR = d.hangingRing.innerDiameterMm / 2
    const ringCx = 0
    const ringCz = r + ringR * 0.7
    const ringOuter = transforms.translate(
      [ringCx, 0, ringCz],
      primitives.cylinder({ radius: ringR, height: d.thicknessMm, segments: 48 }),
    )
    const ringHole = transforms.translate(
      [ringCx, 0, ringCz],
      primitives.cylinder({
        radius: ringHoleR,
        height: d.thicknessMm + 1,
        segments: 32,
      }),
    )
    const ring = booleans.subtract(ringOuter, ringHole) as Geom3
    solid = booleans.union(solid, ring) as Geom3
  }

  // Hanging hole (pendant)
  if (d.hangingHole) {
    const holeR = d.hangingHole.diameterMm / 2
    const edgePad = Math.max(holeR * 1.5, 5)
    const offset = r - edgePad
    const pos = d.hangingHole.position
    const xy = (() => {
      switch (pos) {
        case 'top':        return [0,        offset]      as const
        case 'top_left':   return [-offset * 0.7,  offset * 0.7] as const
        case 'top_right':  return [ offset * 0.7,  offset * 0.7] as const
        case 'left':       return [-offset, 0]             as const
        case 'right':      return [ offset, 0]             as const
        case 'bottom':     return [0,       -offset]      as const
      }
    })()
    const hole = transforms.translate(
      [xy[0], xy[1], 0],
      primitives.cylinder({
        radius: holeR,
        height: d.thicknessMm + 1,
        segments: 32,
      }),
    )
    solid = booleans.subtract(solid, hole) as Geom3
  }

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyDiscLogo(solid, d, ctx.logoImageBuffer)
    solid = res.solid
    logo = res.logo
  }

  // Translate so bottom sits at z=0 for printing.
  const shiftZ = d.thicknessMm / 2
  solid = transforms.translate([0, 0, shiftZ], solid) as Geom3
  if (logo) {
    logo = transforms.translate([0, 0, shiftZ], logo) as Geom3
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(solid),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'disc',
      bboxMm: { x: d.diameterMm, y: d.diameterMm, z: d.thicknessMm },
    },
  }
}

async function applyDiscLogo(
  solid: Geom3,
  d: Extract<Design, { kind: 'disc' }>,
  imageBuffer: Buffer,
): Promise<{ solid: Geom3; logo?: Geom3 }> {
  if (!d.logo) return { solid }
  const overshoot = 0.5
  const engraveDepth = d.logo.depthMm ?? 1.5
  const embossDepth = d.logo.depthMm ?? 2
  const targetMaxDim = d.diameterMm * d.logo.sizeRatio

  const slabT =
    d.logo.treatment === 'through_cut' ? d.thicknessMm + overshoot * 2
    : d.logo.treatment === 'embossed'  ? embossDepth + overshoot
    : /* engraved */                     engraveDepth + overshoot

  const logo = await extrudeLogo({
    imageBuffer,
    targetMaxDim,
    depthMm: slabT,
    ignoreHolesSmallerThan: 0,
    binaryThreshold: d.logo.binaryThreshold,
    addBridges: d.logo.addBridges,
    texture: d.logo.texture,
  })

  const logoGeom3 = alignFlatLogoGeom3(logo.geom3, d.thicknessMm, d.logo, slabT, overshoot)
  if (d.logo.treatment === 'embossed') {
    return { solid, logo: logoGeom3 }
  }
  if (d.logo.treatment === 'engraved') {
    const pocketSolid = booleans.subtract(solid, logoGeom3) as Geom3
    const inlay = booleans.intersect(solid, logoGeom3) as Geom3
    return { solid: pocketSolid, logo: inlay }
  }
  return { solid: booleans.subtract(solid, logoGeom3) as Geom3 }
}

async function buildPin(
  d: Extract<Design, { kind: 'pin' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const r = d.diameterMm / 2
  const discThickness = d.thicknessMm

  // Build the main disc, centered in Z (from -discThickness/2 to +discThickness/2)
  let solid: Geom3 = primitives.cylinder({
    radius: r,
    height: discThickness,
    segments: 96,
  }) as Geom3

  // Attach a cylindrical pin post to the top face (+Z).
  // The top face is at Z = discThickness/2.
  // The pin starts at Z = discThickness/2 and goes up by pinHeightMm.
  // So its center Z is discThickness/2 + pinHeightMm/2.
  const pinR = d.pinDiameterMm / 2
  const pinH = d.pinHeightMm
  const pin = transforms.translate(
    [0, 0, discThickness / 2 + pinH / 2],
    primitives.cylinder({
      radius: pinR,
      height: pinH,
      segments: 32,
    })
  )
  solid = booleans.union(solid, pin) as Geom3

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyDiscLogo(solid, d as any, ctx.logoImageBuffer)
    solid = res.solid
    logo = res.logo
  }

  // Ground: shift everything so bottom face of the disc sits at Z=0.
  // Since the disc was centered at Z = 0, its bottom face was at -discThickness/2.
  // So we translate up by discThickness/2.
  const shiftZ = discThickness / 2
  solid = transforms.translate([0, 0, shiftZ], solid) as Geom3
  if (logo) {
    logo = transforms.translate([0, 0, shiftZ], logo) as Geom3
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(solid),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'pin',
      bboxMm: { x: d.diameterMm, y: d.diameterMm, z: discThickness + pinH },
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// composite
// ────────────────────────────────────────────────────────────────────────────

async function buildComposite(
  d: Extract<Design, { kind: 'composite' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const bodies: MeshBody[] = []
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity

  for (const part of d.parts) {
    const subResult = await generateFromDesign(part.primitive, ctx)
    for (const body of subResult.bodies) {
      const pos = body.positions
      const shifted = new Float32Array(pos.length)
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]
        const y = pos[i + 1]
        const z = pos[i + 2] + part.offsetZ
        shifted[i] = x
        shifted[i + 1] = y
        shifted[i + 2] = z

        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }

      bodies.push({
        positions: shifted,
        extruder: body.extruder === 'A' ? part.extruder : body.extruder,
        label: `${part.primitive.kind}_${body.label}`,
      })
    }
  }

  return {
    bodies,
    meta: {
      kind: 'composite',
      bboxMm: {
        x: maxX - minX,
        y: maxY - minY,
        z: maxZ - minZ,
      },
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

function transformGeom3Vertices(
  g: Geom3,
  mapFn: (v: [number, number, number]) => [number, number, number]
): Geom3 {
  const polys = geometries.geom3.toPolygons(g)
  const newPolys = polys.map(poly => ({
    ...poly,
    vertices: poly.vertices.map(v => mapFn(v as [number, number, number])),
  }))
  return geometries.geom3.create(newPolys)
}

function wrapVertexCylindrically(
  v: [number, number, number],
  wrapR: number,
  zCenterOffset: number,
): [number, number, number] {
  const lx = v[0]
  const ly = v[1]
  const lz = v[2]
  const theta = lx / wrapR
  const r = wrapR + ly
  return [r * Math.sin(theta), r * Math.cos(theta), lz + zCenterOffset]
}

function placeVertexFlat(
  v: [number, number, number],
  wrapR: number,
  zCenterOffset: number,
): [number, number, number] {
  return [-v[0], -v[1] + wrapR, v[2] + zCenterOffset]
}

function alignFlatLogoGeom3(
  logoGeom3: Geom3,
  thicknessMm: number,
  logo: LogoSpec,
  slabT: number,
  overshoot: number
): Geom3 {
  const topZ = thicknessMm / 2
  const bottomZ = -thicknessMm / 2
  const isBottom = logo.position === 'bottom_face'
  const zFace = isBottom ? bottomZ : topZ

  const dzMid =
    logo.treatment === 'through_cut' ? 0
    : logo.treatment === 'embossed'
      ? (isBottom ? zFace + overshoot - slabT / 2 : zFace - overshoot + slabT / 2)
      : /* engraved */
        (isBottom ? zFace - overshoot / 2 + slabT / 2 : zFace + overshoot / 2 - slabT / 2)

  let aligned = transforms.rotateX(-Math.PI / 2, logoGeom3) as Geom3
  if (isBottom) {
    aligned = transforms.mirrorX(aligned) as Geom3
  } else {
    aligned = transforms.mirrorZ(aligned) as Geom3
  }

  return transforms.translate([0, 0, dzMid], aligned) as Geom3
}

function geom3ToPositions(g: Geom3): Float32Array {
  const polys = geometries.geom3.toPolygons(g)
  const out: number[] = []
  for (const poly of polys) {
    const verts = poly.vertices
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        out.push(v[0], v[1], v[2])
      }
    }
  }
  return new Float32Array(out)
}

function geom3ToStl(g: Geom3): Uint8Array {
  const positions = geom3ToPositions(g)
  return serializeBinarySTL(Array.from(positions))
}

async function buildCustomKeychain(
  d: Extract<Design, { kind: 'custom_keychain' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  if (!d.logo || !ctx.logoImageBuffer) {
    const rRadius = Math.min(4, d.thicknessMm / 2 - 0.1)
    const dummy = primitives.roundedCuboid({ size: [40, 40, d.thicknessMm], roundRadius: rRadius, segments: 16 })
    return {
      bodies: [
        {
          positions: geom3ToPositions(dummy as Geom3),
          extruder: d.extruder ?? 'A',
          label: 'Body',
        },
      ],
      meta: {
        kind: 'custom_keychain',
        bboxMm: { x: 40, y: 40, z: d.thicknessMm },
      },
    }
  }

  const sizeRatio = d.logo.sizeRatio ?? 0.8
  const baseSize = 50
  const targetMaxDim = baseSize * sizeRatio
  const overshoot = 0.5

  const engraveDepth = d.logo.depthMm ?? 1.5
  const embossDepth = d.logo.depthMm ?? 2
  const slabT =
    d.logo.treatment === 'through_cut' ? d.thicknessMm + overshoot * 2
    : d.logo.treatment === 'embossed'  ? embossDepth + overshoot
    : /* engraved */                     engraveDepth + overshoot

  const logoResult = await extrudeLogo({
    imageBuffer: ctx.logoImageBuffer,
    targetMaxDim,
    depthMm: slabT,
    ignoreHolesSmallerThan: 0,
    binaryThreshold: d.logo.binaryThreshold,
    addBridges: d.logo.addBridges,
    texture: d.logo.texture,
  })

  const logo2DOuters = logoResult.logo2DOuters

  let solid: Geom3
  if (logo2DOuters && logo2DOuters.length > 0) {
    // Filter out tiny noise polygons (less than 2.0mm in size)
    const filteredOuters = logo2DOuters.filter(g => {
      const points = geometries.geom2.toPoints(g)
      let minX = Infinity, maxX = -Infinity
      let minY = Infinity, maxY = -Infinity
      for (const p of points) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
      }
      const w = maxX - minX
      const h = maxY - minY
      return Math.max(w, h) >= 2.0
    })

    if (filteredOuters.length > 0) {
      // Union the raw outer contours in 2D first. Because they are raw traced contours,
      // they are naturally disjoint and unioning them in 2D is 100% stable and fast.
      const merged2D = filteredOuters.length === 1 ? filteredOuters[0] : booleans.union(...filteredOuters)
      // Expand the merged 2D footprint to form the contoured base plate.
      // We use segments: 4 to keep the 3D CSG subtraction performance fast and stable (3.5s instead of 107s).
      const base2D = expansions.expand({ delta: d.paddingMm, corners: 'round', segments: 4 }, merged2D)
      // Extrude the unified base plate to 3D.
      solid = extrusions.extrudeLinear({ height: d.thicknessMm }, base2D) as Geom3
    } else {
      const base2D = primitives.roundedRectangle({ size: [targetMaxDim + d.paddingMm * 2, targetMaxDim + d.paddingMm * 2], roundRadius: d.paddingMm })
      solid = extrusions.extrudeLinear({ height: d.thicknessMm }, base2D) as Geom3
    }
  } else {
    const base2D = primitives.roundedRectangle({ size: [targetMaxDim + d.paddingMm * 2, targetMaxDim + d.paddingMm * 2], roundRadius: d.paddingMm })
    solid = extrusions.extrudeLinear({ height: d.thicknessMm }, base2D) as Geom3
  }

  const polys = geometries.geom3.toPolygons(solid)
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  for (const poly of polys) {
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0]
      if (v[0] > maxX) maxX = v[0]
      if (v[1] < minY) minY = v[1]
      if (v[1] > maxY) maxY = v[1]
    }
  }

  const ringOuterRadius = 5.5
  const ringInnerRadius = 2.5
  const Cx = (minX + maxX) / 2
  const Cy = maxY + 3

  // Center the extruded base around Z=0 so logo placement aligns correctly
  solid = transforms.translate([0, 0, -d.thicknessMm / 2], solid) as Geom3

  let logoGeom3 = alignFlatLogoGeom3(logoResult.geom3, d.thicknessMm, d.logo, slabT, overshoot)

  if (d.logo.treatment === 'engraved') {
    const pocketSolid = booleans.subtract(solid, logoGeom3) as Geom3
    const inlay = booleans.intersect(solid, logoGeom3) as Geom3
    solid = pocketSolid
    logoGeom3 = inlay
  } else if (d.logo.treatment === 'through_cut') {
    solid = booleans.subtract(solid, logoGeom3) as Geom3
    logoGeom3 = undefined as any
  }

  // Create and add the keyring loop AFTER the logo has been subtracted.
  // This guarantees that the logo cutout channels cannot intersect or cut open the loop's walls.
  const outerRing = transforms.translate(
    [Cx, Cy, 0],
    primitives.cylinder({ radius: ringOuterRadius, height: d.thicknessMm, segments: 32 })
  )
  const innerRing = transforms.translate(
    [Cx, Cy, 0],
    primitives.cylinder({ radius: ringInnerRadius, height: d.thicknessMm + 2, segments: 24 })
  )

  solid = booleans.union(solid, outerRing) as Geom3
  solid = booleans.subtract(solid, innerRing) as Geom3

  const shiftZ = d.thicknessMm / 2
  solid = transforms.translate([0, 0, shiftZ], solid) as Geom3
  if (logoGeom3) {
    logoGeom3 = transforms.translate([0, 0, shiftZ], logoGeom3) as Geom3
  }

  const finalBbox = geometries.geom3.toPolygons(solid)
  let fMinX = Infinity, fMaxX = -Infinity
  let fMinY = Infinity, fMaxY = -Infinity
  for (const p of finalBbox) {
    for (const v of p.vertices) {
      if (v[0] < fMinX) fMinX = v[0]; if (v[0] > fMaxX) fMaxX = v[0]
      if (v[1] < fMinY) fMinY = v[1]; if (v[1] > fMaxY) fMaxY = v[1]
    }
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(solid),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logoGeom3) {
    bodies.push({
      positions: geom3ToPositions(logoGeom3),
      extruder: d.logo.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'custom_keychain',
      bboxMm: { x: fMaxX - fMinX, y: fMaxY - fMinY, z: d.thicknessMm },
    },
  }
}

async function buildMug(
  d: Extract<Design, { kind: 'mug' }>,
  ctx: GenerateContext,
): Promise<InternalBuildResult> {
  const insideR = d.insideDiameterMm / 2
  const outsideR = insideR + d.wallMm
  const height = d.heightMm
  const base = d.baseMm

  const outer = transforms.translate(
    [0, 0, height / 2],
    primitives.cylinder({ radius: outsideR, height, segments: 96 }),
  )

  const hThickness = d.handleThicknessMm
  const hHeight = d.handleHeightMm
  const hStickOut = d.handleStickOutMm

  let handle = primitives.torus({
    innerRadius: hThickness / 2,
    outerRadius: (hHeight - hThickness) / 2,
    innerSegments: 24,
    outerSegments: 48,
  })

  handle = transforms.rotateX(Math.PI / 2, handle)
  const scaleY = hStickOut / (hHeight / 2)
  handle = transforms.scale([1, scaleY, 1], handle)
  handle = transforms.translate([0, -outsideR, height / 2], handle)

  let cup = booleans.union(outer, handle) as Geom3

  const innerH = height - base + 1
  const inner = transforms.translate(
    [0, 0, base + innerH / 2],
    primitives.cylinder({ radius: insideR, height: innerH, segments: 96 }),
  )
  cup = booleans.subtract(cup, inner) as Geom3

  let logo: Geom3 | undefined
  if (d.logo && ctx.logoImageBuffer) {
    const res = await applyCylinderLogo(cup, d, ctx.logoImageBuffer)
    cup = res.solid
    logo = res.logo
  }

  const bodies: MeshBody[] = [
    {
      positions: geom3ToPositions(cup),
      extruder: d.extruder ?? 'A',
      label: 'Body',
    },
  ]
  if (logo) {
    bodies.push({
      positions: geom3ToPositions(logo),
      extruder: d.logo?.extruder ?? 'B',
      label: 'Logo',
    })
  }

  return {
    bodies,
    meta: {
      kind: 'mug',
      bboxMm: { x: outsideR * 2, y: outsideR * 2 + hStickOut, z: height },
    },
  }
}
