/**
 * Universal composer: Meshy generates ANY shape from the user's text; we
 * carve / attach the user's REAL logo to the result. Works for any shape
 * — flat plaques get the logo carved into the dominant face; blob-like or
 * cylindrical shapes get a small flat "branded tag" attached to the side.
 *
 * Pipeline:
 *   1. Augment user prompt with hint about "flat panel for logo" so Meshy
 *      biases toward shapes the carving step can handle cleanly.
 *   2. Meshy generates the shape.
 *   3. Repair + Y-up→Z-up + scale.
 *   4. Bbox the result. Classify shape into FLAT-Y / FLAT-Z / FLAT-X / BLOB
 *      based on how dominant the thinnest axis is.
 *   5. Place logo:
 *      - FLAT-Y / FLAT-Z / FLAT-X → carve into the dominant face
 *      - BLOB → attach a separate flat tag to the side
 *   6. Concat triangles → STL.
 */
import { extrudeLogo } from '@/lib/logo-extrude/extrude'
import { generateMesh } from '@/lib/meshy/client'
import { repairAndPrepareMesh } from '@/lib/compose/repair-mesh'
import { parseBinarySTL } from '@/lib/jscad/runner'
import { serializeBinarySTL } from '@/lib/stl/serialize'

export interface ComposeWithMeshyOptions {
  /** Raw user message describing the SHAPE only. NOT the logo. */
  shapePrompt: string
  meshyApiKey: string
  logoImageBuffer: Buffer
  /** Mesh's largest dim in mm after scaling (default 60). */
  meshTargetMaxDim?: number
  /** How thick the logo relief is in mm. */
  reliefDepthMm?: number
  /** Logo's largest dim as a fraction of min(meshWidth, meshHeight). Default 0.6. */
  logoSizeRatio?: number
}

export interface ComposeWithMeshyResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    meshyTookMs: number
    meshyTriangleCount: number
    logoTriangleCount: number
    /** Which strategy was used to attach the logo. */
    logoStrategy: 'flat-x' | 'flat-y' | 'flat-z' | 'tag-side'
  }
}

/**
 * Append a hint to the user's prompt asking Meshy for a shape with a flat
 * surface suitable for logo placement. Significant for shapes Meshy would
 * otherwise generate as smooth cylinders/blobs (cans, vases, sculptures).
 */
function augmentShapePrompt(userPrompt: string): string {
  const lower = userPrompt.toLowerCase()
  // If the user already mentioned "flat", "plano", "painel", they know what
  // they're doing — don't double-up.
  if (/\b(flat|plano|painel|panel|face\s+plana|frente\s+plana)\b/i.test(lower)) {
    return userPrompt
  }
  return `${userPrompt}. Include a large flat front panel or surface suitable for engraving a brand logo.`
}

export async function composeWithMeshyBase(
  opts: ComposeWithMeshyOptions,
): Promise<ComposeWithMeshyResult> {
  const meshTargetMaxDim = opts.meshTargetMaxDim ?? 60
  const reliefDepthMm = opts.reliefDepthMm ?? 2.5
  const logoSizeRatio = opts.logoSizeRatio ?? 0.6

  // Step 1: Meshy with augmented prompt.
  const augmentedPrompt = augmentShapePrompt(opts.shapePrompt)
  const meshyResult = await generateMesh({
    prompt: augmentedPrompt,
    apiKey: opts.meshyApiKey,
  })
  if (!meshyResult.ok) {
    throw new Error(`Meshy shape generation failed: ${meshyResult.error}`)
  }

  // Step 2: repair.
  const meshyPrepared = repairAndPrepareMesh(meshyResult.stl, {
    targetMaxDim: meshTargetMaxDim,
    mirrorX: false,
    yUpToZUp: true,
  })

  // Step 3: bbox.
  const meshyPositions = parseBinarySTL(meshyPrepared)
  let mMinX = Infinity, mMaxX = -Infinity
  let mMinY = Infinity, mMaxY = -Infinity
  let mMinZ = Infinity, mMaxZ = -Infinity
  for (let i = 0; i < meshyPositions.length; i += 3) {
    const x = meshyPositions[i], y = meshyPositions[i + 1], z = meshyPositions[i + 2]
    if (x < mMinX) mMinX = x; if (x > mMaxX) mMaxX = x
    if (y < mMinY) mMinY = y; if (y > mMaxY) mMaxY = y
    if (z < mMinZ) mMinZ = z; if (z > mMaxZ) mMaxZ = z
  }
  const meshWidth = mMaxX - mMinX
  const meshHeight = mMaxZ - mMinZ
  const meshDepth = mMaxY - mMinY

  // Step 4: classify shape. If the smallest dim is much smaller than the
  // largest (ratio < 0.55), it's "flat" along that axis — carve directly.
  // Otherwise it's blob-like or cylindrical → fall back to a tag.
  const dims: [number, number, number] = [meshWidth, meshDepth, meshHeight]
  const minDim = Math.min(...dims)
  const maxDim = Math.max(...dims)
  const flatness = minDim / maxDim
  const FLAT_THRESHOLD = 0.55 // anything below this is "flat" along thinnest axis
  const minAxis: 0 | 1 | 2 = dims.indexOf(minDim) as 0 | 1 | 2

  let logoStrategy: ComposeWithMeshyResult['meta']['logoStrategy']
  let logoMaxDim: number
  let reliefForLogo: number

  if (flatness < FLAT_THRESHOLD) {
    // Flat-faced object — carve into the dominant face. Logo can be big.
    logoStrategy = minAxis === 0 ? 'flat-x' : minAxis === 1 ? 'flat-y' : 'flat-z'
    logoMaxDim = Math.min(
      minAxis === 0 ? meshDepth : meshWidth,
      minAxis === 2 ? meshDepth : meshHeight,
    ) * logoSizeRatio
    reliefForLogo = reliefDepthMm
  } else {
    // Blob / cylindrical — no clean flat face. Attach a flat TAG to the side.
    // Tag is sized 50-70% of the smallest mesh dimension so it doesn't dwarf
    // the host. Logo fills the tag.
    logoStrategy = 'tag-side'
    logoMaxDim = minDim * 0.7
    reliefForLogo = Math.max(reliefDepthMm, 3) // thicker tag for visibility
  }

  // Step 5: extrude logo at chosen size + thickness.
  const logo = await extrudeLogo({
    imageBuffer: opts.logoImageBuffer,
    targetMaxDim: logoMaxDim,
    depthMm: reliefForLogo,
    ignoreHolesSmallerThan: 0.3,
  })
  const logoPositions = parseBinarySTL(logo.stl)
  let lMinX = Infinity, lMaxX = -Infinity
  let lMinY = Infinity, lMaxY = -Infinity
  let lMinZ = Infinity, lMaxZ = -Infinity
  for (let i = 0; i < logoPositions.length; i += 3) {
    const x = logoPositions[i], y = logoPositions[i + 1], z = logoPositions[i + 2]
    if (x < lMinX) lMinX = x; if (x > lMaxX) lMaxX = x
    if (y < lMinY) lMinY = y; if (y > lMaxY) lMaxY = y
    if (z < lMinZ) lMinZ = z; if (z > lMaxZ) lMaxZ = z
  }
  const logoW = lMaxX - lMinX
  const logoH = lMaxZ - lMinZ
  const logoThick = lMaxY - lMinY

  // Step 6: position logo according to strategy.
  type Vec3 = [number, number, number]
  let transform: (lx: number, ly: number, lz: number) => Vec3
  const overlap = 0.4
  const margin = 4 // border around logo on the tag plate

  // For the tag strategy we ALSO generate a backing plate (flat rectangle)
  // sized to bound the logo + margin. That plate sits behind the logo and
  // attaches to the mesh side.
  const tagBackingTriangles: number[] = []

  if (logoStrategy === 'flat-y') {
    const dy = mMinY - reliefForLogo / 2 + overlap
    const dx = (mMinX + mMaxX) / 2 - (lMinX + lMaxX) / 2
    const dz = (mMinZ + mMaxZ) / 2 - (lMinZ + lMaxZ) / 2
    transform = (lx, ly, lz) => [lx + dx, ly + dy, lz + dz]
  } else if (logoStrategy === 'flat-z') {
    const dz = mMaxZ + reliefForLogo / 2 - overlap
    const dx = (mMinX + mMaxX) / 2 - (lMinX + lMaxX) / 2
    const dy = (mMinY + mMaxY) / 2 - (lMinZ + lMaxZ) / 2
    transform = (lx, ly, lz) => [lx + dx, lz + dy, -ly + dz]
  } else if (logoStrategy === 'flat-x') {
    const dx = mMinX - reliefForLogo / 2 + overlap
    const dy = (mMinY + mMaxY) / 2 - (lMinY + lMaxY) / 2
    const dz = (mMinZ + mMaxZ) / 2 - (lMinX + lMaxX) / 2
    transform = (lx, ly, lz) => [-ly + dx, lx + dy, lz + dz]
  } else {
    // TAG-SIDE: attach a flat backed plate with the logo on the +X side of
    // the mesh. The tag's back overlaps with the mesh's +X face by `overlap`;
    // the rest extends outward in +X.
    //
    // Logo's image-X stays as world-X (parallel to mesh +X normal? No — we
    // want the logo READABLE from +X direction, which means image-X axis
    // perpendicular to that direction). So we rotate logo 90° around Y:
    // (x,y,z) → (z,y,-x). Image-X (was world-X) → world-Z; image-Y stays;
    // thickness (was Y) stays. Wait — let me re-check.
    //
    // We want:
    //   - Logo plane parallel to YZ plane (perpendicular to X normal)
    //   - Image-X → world-Y (so it reads horizontally when viewed from +X)
    //   - Image-Y → world-Z
    //   - Thickness → world-X
    //
    // Logo from extrudeLogo: image-X → mesh X, image-Y → mesh Z, thickness → mesh Y.
    // To remap: x → y; y → x (thickness); z → z.
    // Per-vertex: (lx, ly, lz) → (ly, lx, lz)  with appropriate translations.
    //
    // Place tag with back face at world X = mMaxX (just overlapping the
    // mesh's right side).
    const tagThickness = reliefForLogo
    const tagBackX = mMaxX - overlap // tag's back face overlaps mesh by overlap
    const tagCenterY = (mMinY + mMaxY) / 2 - (lMinX + lMaxX) / 2
    const tagCenterZ = (mMinZ + mMaxZ) / 2 - (lMinZ + lMaxZ) / 2

    transform = (lx, ly, lz) => [
      ly + tagBackX + tagThickness / 2,
      lx + tagCenterY,
      lz + tagCenterZ,
    ]

    // Generate a backing rectangle (flat plate) for the tag so the logo cuts
    // are visible against a solid background, not just hanging in space.
    //
    // Backing dimensions: logo bbox + margin all around. Backing thickness =
    // tagThickness (matches logo slab thickness). Position: same as logo.
    const backingY = logoW + margin * 2
    const backingZ = logoH + margin * 2
    const backingX = tagThickness * 0.8 // slightly thinner than logo so logo sticks out
    const backingCx = tagBackX + backingX / 2
    const backingCy = (mMinY + mMaxY) / 2
    const backingCz = (mMinZ + mMaxZ) / 2

    // 8 corners of a cuboid:
    const corners: Vec3[] = [
      [backingCx - backingX / 2, backingCy - backingY / 2, backingCz - backingZ / 2],
      [backingCx + backingX / 2, backingCy - backingY / 2, backingCz - backingZ / 2],
      [backingCx + backingX / 2, backingCy + backingY / 2, backingCz - backingZ / 2],
      [backingCx - backingX / 2, backingCy + backingY / 2, backingCz - backingZ / 2],
      [backingCx - backingX / 2, backingCy - backingY / 2, backingCz + backingZ / 2],
      [backingCx + backingX / 2, backingCy - backingY / 2, backingCz + backingZ / 2],
      [backingCx + backingX / 2, backingCy + backingY / 2, backingCz + backingZ / 2],
      [backingCx - backingX / 2, backingCy + backingY / 2, backingCz + backingZ / 2],
    ]
    // 12 triangles (2 per face). Order: outward-facing winding.
    const faces: [number, number, number][] = [
      [0, 1, 2], [0, 2, 3], // -Z bottom
      [4, 6, 5], [4, 7, 6], // +Z top
      [0, 5, 1], [0, 4, 5], // -Y front
      [2, 6, 7], [2, 7, 3], // +Y back (mesh side)
      [0, 3, 7], [0, 7, 4], // -X left (mesh side)
      [1, 5, 6], [1, 6, 2], // +X right (outward)
    ]
    for (const [a, b, c] of faces) {
      tagBackingTriangles.push(
        corners[a][0], corners[a][1], corners[a][2],
        corners[b][0], corners[b][1], corners[b][2],
        corners[c][0], corners[c][1], corners[c][2],
      )
    }
  }

  // Step 7: concat all triangles.
  const out: number[] = Array.from(meshyPositions)
  for (let i = 0; i < tagBackingTriangles.length; i++) {
    out.push(tagBackingTriangles[i])
  }
  for (let i = 0; i < logoPositions.length; i += 3) {
    const v = transform(logoPositions[i], logoPositions[i + 1], logoPositions[i + 2])
    out.push(v[0], v[1], v[2])
  }
  const stl = serializeBinarySTL(out)

  // Recompute final bbox over all triangles.
  let fMinX = Infinity, fMaxX = -Infinity
  let fMinY = Infinity, fMaxY = -Infinity
  let fMinZ = Infinity, fMaxZ = -Infinity
  for (let i = 0; i < out.length; i += 3) {
    if (out[i] < fMinX) fMinX = out[i]; if (out[i] > fMaxX) fMaxX = out[i]
    if (out[i + 1] < fMinY) fMinY = out[i + 1]; if (out[i + 1] > fMaxY) fMaxY = out[i + 1]
    if (out[i + 2] < fMinZ) fMinZ = out[i + 2]; if (out[i + 2] > fMaxZ) fMaxZ = out[i + 2]
  }

  void logoThick // suppress lint; reserved for diagnostics

  return {
    stl,
    meta: {
      bboxMm: { x: fMaxX - fMinX, y: fMaxY - fMinY, z: fMaxZ - fMinZ },
      meshyTookMs: meshyResult.meta.took_ms,
      meshyTriangleCount: meshyPositions.length / 9,
      logoTriangleCount: logoPositions.length / 9,
      logoStrategy,
    },
  }
}
