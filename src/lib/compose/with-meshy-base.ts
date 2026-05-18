/**
 * Universal composer: Meshy generates ANY shape from the user's text;
 * we extrude the user's REAL logo and slap it as relief on the -Y face
 * (camera-facing) of the Meshy mesh.
 *
 * Why this pattern: Meshy text-to-3D handles "trofeu", "estatueta",
 * "porta-canetas", "pingente", etc. — any decorative form describable
 * in words. But Meshy doesn't know the user's specific logo. So we let
 * Meshy do what it's good at (shape) and slap the real logo on top.
 *
 * Pipeline:
 *   1. Meshy generates the shape from raw user text (NO logo description
 *      in the prompt — we don't want Meshy improvising a logo).
 *   2. Repair + Y-up→Z-up + scale (existing repairAndPrepareMesh).
 *   3. Bbox the result.
 *   4. Extrude user's logo as a thin relief slab.
 *   5. Position the logo at the mesh's -Y face (camera-facing in default view)
 *      with most of the slab sticking outward and a small overlap inward
 *      for slicer-safe connection.
 *   6. Concatenate the Meshy triangles + the logo triangles → STL.
 *
 * Concat instead of CSG union: way faster on dense Meshy meshes (~30k tri)
 * and produces a printable mesh when the logo overlaps the host. Slicers
 * handle overlapping solids without complaint.
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
  /** How thick the logo relief is in mm. Logo will sit so most of this
   * thickness protrudes outward, with a small overlap into the mesh. */
  reliefDepthMm?: number
  /** Logo's largest dim as a fraction of min(meshWidth, meshHeight). */
  logoSizeRatio?: number
}

export interface ComposeWithMeshyResult {
  stl: Uint8Array
  meta: {
    bboxMm: { x: number; y: number; z: number }
    meshyTookMs: number
    meshyTriangleCount: number
    logoTriangleCount: number
  }
}

export async function composeWithMeshyBase(
  opts: ComposeWithMeshyOptions,
): Promise<ComposeWithMeshyResult> {
  const meshTargetMaxDim = opts.meshTargetMaxDim ?? 60
  const reliefDepthMm = opts.reliefDepthMm ?? 2.5
  const logoSizeRatio = opts.logoSizeRatio ?? 0.6

  // Step 1: Meshy generates the SHAPE. Send raw user text — no logo
  // description added — so Meshy doesn't try to invent a logo.
  const meshyResult = await generateMesh({
    prompt: opts.shapePrompt,
    apiKey: opts.meshyApiKey,
  })
  if (!meshyResult.ok) {
    throw new Error(`Meshy shape generation failed: ${meshyResult.error}`)
  }

  // Step 2: repair (manifold + Y-up→Z-up + scale to target max dim).
  const meshyPrepared = repairAndPrepareMesh(meshyResult.stl, {
    targetMaxDim: meshTargetMaxDim,
    mirrorX: false,
    yUpToZUp: true,
  })

  // Step 3: bbox the prepared Meshy mesh.
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

  // Step 4: extrude the logo. Size relative to the smaller of width/height
  // so it always fits on the front face.
  const logoMaxDim = Math.min(meshWidth, meshHeight) * logoSizeRatio
  const logo = await extrudeLogo({
    imageBuffer: opts.logoImageBuffer,
    targetMaxDim: logoMaxDim,
    depthMm: reliefDepthMm,
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

  // Step 5: detect the mesh's "natural front face" and place the logo there.
  //
  // The natural face is the one perpendicular to the THINNEST axis:
  //   - Y is thinnest → vertical plaque, front = -Y face (camera-facing)
  //   - Z is thinnest → horizontal disc/medal, front = +Z face (top)
  //   - X is thinnest → wide flat thing, front = -X face
  //
  // For each case the logo must be ROTATED so its image plane is parallel
  // to that face. After extrudeLogo, the logo's image plane is XZ (vertical)
  // with Y as the thickness axis. So we may need to rotate around X or Y.
  const overlap = 0.4
  const dims: [number, number, number] = [meshWidth, meshDepth, meshHeight]
  const minDim = Math.min(...dims)
  const minAxis: 0 | 1 | 2 = dims.indexOf(minDim) as 0 | 1 | 2

  // Per-vertex transform: returns the final (x, y, z) for a logo vertex.
  type Vec3 = [number, number, number]
  let transform: (lx: number, ly: number, lz: number) => Vec3

  if (minAxis === 1) {
    // VERTICAL PLAQUE — logo already aligned (image plane = XZ, thickness = Y).
    // Place it on the -Y face, sticking outward in -Y direction.
    const dy = mMinY - reliefDepthMm / 2 + overlap
    const dx = (mMinX + mMaxX) / 2 - (lMinX + lMaxX) / 2
    const dz = (mMinZ + mMaxZ) / 2 - (lMinZ + lMaxZ) / 2
    transform = (lx, ly, lz) => [lx + dx, ly + dy, lz + dz]
  } else if (minAxis === 2) {
    // HORIZONTAL DISC / MEDAL — logo must lie FLAT on the top face.
    // Rotate logo -90° around X so its image plane goes from XZ → XY.
    // (x, y, z) → (x, z, -y): image-Y becomes the new Y (lies flat), thickness
    // becomes -Z (the slab now extends along Z axis).
    // Then translate so the top of the logo slab sits at +meshMaxZ + small overshoot.
    const dz = mMaxZ + reliefDepthMm / 2 - overlap
    const dx = (mMinX + mMaxX) / 2 - (lMinX + lMaxX) / 2
    // After rotation, the logo's NEW Y range = old Z range (image height).
    // Center on the disc's Y center.
    const dy = (mMinY + mMaxY) / 2 - (lMinZ + lMaxZ) / 2
    transform = (lx, ly, lz) => [lx + dx, lz + dy, -ly + dz]
  } else {
    // WIDE FLAT — logo on -X face. Rotate -90° around Y so image plane goes
    // from XZ → YZ. (x, y, z) → (z, y, -x): image-X becomes new Z, thickness
    // becomes new -X.
    const dx = mMinX - reliefDepthMm / 2 + overlap
    const dy = (mMinY + mMaxY) / 2 - (lMinY + lMaxY) / 2
    const dz = (mMinZ + mMaxZ) / 2 - (lMinX + lMaxX) / 2
    transform = (lx, ly, lz) => [-ly + dx, lx + dy, lz + dz]
  }

  // Step 6: concat Meshy triangles + transformed logo triangles.
  const out: number[] = Array.from(meshyPositions)
  for (let i = 0; i < logoPositions.length; i += 3) {
    const v = transform(logoPositions[i], logoPositions[i + 1], logoPositions[i + 2])
    out.push(v[0], v[1], v[2])
  }
  const stl = serializeBinarySTL(out)

  return {
    stl,
    meta: {
      bboxMm: {
        x: meshWidth,
        y: meshDepth + (reliefDepthMm - overlap),
        z: meshHeight,
      },
      meshyTookMs: meshyResult.meta.took_ms,
      meshyTriangleCount: meshyPositions.length / 9,
      logoTriangleCount: logoPositions.length / 9,
    },
  }
}
