/**
 * parametric_code pipeline — the "generate anything geometric" escape hatch.
 *
 * Split in two so the executor is unit-testable without an LLM:
 *  - generateParametricCode(): asks the MAIN model (not the classifier) to
 *    write JSCAD source for a spec, optionally starting from previous working
 *    code and/or the error feedback of a failed attempt.
 *  - executeParametricCode(): compiles the source in the existing sandbox
 *    (compileUserModule — the only dynamic-compile point in the codebase),
 *    runs main(), grounds the result on z=0 and validates printability.
 *
 * generateFromDesign wires them into an execute→validate→repair loop.
 */
import { generateText } from 'ai'
import { getModel } from '@/lib/llm/model'
import { compileUserModule } from '@/lib/jscad/sandbox'
import { analyzeMeshValidity, MAX_ANALYZE_TRIANGLES } from '@/lib/mesh/validity'
import type { Geom3 } from '@jscad/modeling/src/geometries/geom3'

/** Max overall dimension accepted from generated code (H2D bed is 350×320,
 * but every other primitive clamps to ≤300 — keep the same ceiling). */
const MAX_DIM_MM = 300
const MIN_DIM_MM = 1
const EXEC_TIMEOUT_MS = 30_000

export interface ExecutedCode {
  /** Triangle soup (9 floats per triangle), grounded at z = 0. */
  positions: Float32Array
  bboxMm: { x: number; y: number; z: number }
}

/**
 * Compile + run LLM-authored JSCAD source and validate the result.
 * Throws with a descriptive message on any failure — the message is fed
 * back to the model on the next repair attempt, so keep it actionable.
 */
export async function executeParametricCode(code: string): Promise<ExecutedCode> {
  const jscadNs = (await import('@jscad/modeling')) as unknown as {
    default?: typeof import('@jscad/modeling')
  } & typeof import('@jscad/modeling')
  const jscad = jscadNs.default ?? jscadNs

  const factory = compileUserModule(code)
  const userMod = factory(jscad)
  if (typeof userMod?.main !== 'function') {
    throw new Error('code must export main() via `module.exports = { main }`')
  }

  const raw = await runWithTimeout(
    () => (userMod.main as () => unknown)(),
    EXEC_TIMEOUT_MS,
  )
  const geoms = (Array.isArray(raw) ? raw : [raw]) as Geom3[]
  if (geoms.length === 0) throw new Error('main() returned an empty array')
  const solid =
    geoms.length === 1 ? geoms[0] : (jscad.booleans.union(...geoms) as Geom3)

  const positions = geomToPositions(jscad, solid)
  const triCount = positions.length / 9
  if (triCount < 4) {
    throw new Error(`main() produced ${triCount} triangles — not a solid`)
  }

  // Bounding box + grounding (bottom face onto the print bed).
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('geometry contains NaN/Infinity coordinates')
    }
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const bbox = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  for (const [axis, size] of Object.entries(bbox)) {
    if (size > MAX_DIM_MM) {
      throw new Error(
        `part is ${size.toFixed(0)}mm on ${axis.toUpperCase()} — exceeds the ` +
        `${MAX_DIM_MM}mm print limit; scale the design down`,
      )
    }
  }
  if (Math.max(bbox.x, bbox.y, bbox.z) < MIN_DIM_MM) {
    throw new Error('part is smaller than 1mm — dimensions are likely in the wrong unit (use mm)')
  }
  if (minZ !== 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ
  }

  // Advisory topology check: only NaN (caught above) is fatal elsewhere in the
  // app, but LLM code producing heavily non-manifold output usually means a
  // broken boolean — feed it back so the model repairs instead of shipping junk.
  if (triCount <= MAX_ANALYZE_TRIANGLES) {
    const report = analyzeMeshValidity(positions)
    if (report.analyzed && report.boundaryEdges > triCount * 0.5) {
      throw new Error(
        `mesh has ${report.boundaryEdges} open edges for ${triCount} triangles — ` +
        'a boolean likely failed; simplify overlapping operations',
      )
    }
  }

  return { positions, bboxMm: bbox }
}

/** Ask the main model for JSCAD source implementing `spec`. */
export async function generateParametricCode(input: {
  spec: string
  previousCode?: string | null
  /** Error from the last failed attempt (execution or validation). */
  errorFeedback?: { code: string; error: string } | null
}): Promise<string> {
  const { spec, previousCode, errorFeedback } = input

  const parts: string[] = [`OBJECT SPEC:\n${spec}`]
  if (previousCode && !errorFeedback) {
    parts.push(
      `CURRENT WORKING CODE (the spec above may be an evolution of it — modify rather than rewrite when possible):\n${previousCode}`,
    )
  }
  if (errorFeedback) {
    parts.push(
      `YOUR PREVIOUS ATTEMPT FAILED.\nERROR: ${errorFeedback.error}\n` +
      `PREVIOUS CODE:\n${errorFeedback.code}\n\nFix the error and output the corrected FULL code.`,
    )
  }
  parts.push('Output ONLY the JavaScript source. No markdown fences, no prose.')

  const { text } = await generateText({
    model: await getModel(),
    system: CODER_SYSTEM,
    prompt: parts.join('\n\n'),
    maxOutputTokens: 4000,
    abortSignal: AbortSignal.timeout(120_000),
  })

  return text
    .trim()
    .replace(/^```(?:js|javascript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function geomToPositions(
  jscad: typeof import('@jscad/modeling'),
  geom: Geom3,
): Float32Array {
  const polygons = jscad.geometries.geom3.toPolygons(geom)
  const out: number[] = []
  for (const poly of polygons) {
    const v = poly.vertices
    for (let i = 2; i < v.length; i++) {
      out.push(v[0][0], v[0][1], v[0][2])
      out.push(v[i - 1][0], v[i - 1][1], v[i - 1][2])
      out.push(v[i][0], v[i][1], v[i][2])
    }
  }
  return new Float32Array(out)
}

function runWithTimeout<T>(fn: () => T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`code execution timeout after ${ms}ms`)),
      ms,
    )
    queueMicrotask(() => {
      try {
        const result = fn()
        clearTimeout(timer)
        resolve(result)
      } catch (e) {
        clearTimeout(timer)
        reject(e)
      }
    })
  })
}

const CODER_SYSTEM = `You write JSCAD (@jscad/modeling v2) JavaScript that models a 3D-printable part from a spec.

# Contract

- Your code runs as a CommonJS module body with three locals: \`jscad\` (the @jscad/modeling namespace), \`module\`, \`exports\`.
- End with: \`module.exports = { main }\`
- \`main()\` takes no arguments and returns ONE Geom3 (or an array of Geom3 that will be unioned).
- Units are millimeters. Model the part in its PRINT orientation: largest flat face down, bottom near z=0 (the runner grounds it exactly).
- No require/import/fetch/process/eval — only the \`jscad\` argument and plain JS.

# API (destructure what you need)

const { primitives, booleans, transforms, extrusions, expansions, geometries, maths, utils } = jscad
- primitives.cuboid({ size:[x,y,z], center:[x,y,z] }), roundedCuboid({ size, roundRadius, segments }), cylinder({ radius, height, center, segments }), roundedCylinder, sphere({ radius, center, segments }), polygon({ points }), torus, ...
- booleans.union(a, b, ...), subtract(base, tool1, ...), intersect(...)
- transforms.translate([x,y,z], g), rotate([rx,ry,rz], g) (RADIANS), rotateX/Y/Z(rad, g), scale([sx,sy,sz], g), mirror({ normal }, g)
- extrusions.extrudeLinear({ height }, geom2), extrusions.extrudeRotate({ segments }, geom2)
- expansions.expand({ delta, corners:'round' }, g), offset
- All primitives are centered at the origin by default — use \`center:\` or translate.

# Gotchas that WILL throw

- \`roundedCuboid\`: \`roundRadius\` must be STRICTLY LESS than half of the SMALLEST size component. A 100×120×6 plate allows roundRadius < 3 — so use 1.5-2, or plain \`cuboid\` for thin plates and round only the tall parts.
- \`roundedCylinder\`: \`roundRadius\` must be < radius AND < height/2.
- \`transforms.rotate*\` take RADIANS (\`deg * Math.PI / 180\`), never degrees.
- \`subtract\` tools must fully cross the solid they cut — oversize them (+2mm each side); a tool that ends exactly on a face leaves a zero-thickness wall.
- Never leave two solids merely touching: overlap ≥0.5mm before \`union\`, or the result is two shells, not one printable part.

# 3D-printing rules (FDM, 0.4mm nozzle)

- Min wall thickness 2mm; min feature 1.5mm.
- The part MUST be a single connected solid (union overlapping pieces with ≥0.5mm overlap — never leave two solids merely touching face-to-face; overlap them).
- Design for printing WITHOUT supports when possible: avoid overhangs > 50° from vertical; prefer chamfers to bridges.
- Fits: add 0.3-0.5mm clearance around objects that must slot in (phones, cards, pens).
- Overall size ≤ 250mm on every axis unless the spec demands more (hard limit 300mm).
- Round user-facing edges (roundedCuboid or expand with round corners) for comfort where it matters.

# Style

- Named constants at the top for every dimension, derived values computed from them.
- Keep segments moderate: 32-64 for visible curves, 16 for small holes.
- Comment only non-obvious constraints (clearances, angles).

# Example — desk phone stand (base + tilted backrest + front lip with cable slot)

const { primitives, booleans, transforms } = jscad

const DEVICE_W = 80      // phone width + case clearance
const DEVICE_T = 12      // phone thickness + case clearance
const ANGLE = 62 * Math.PI / 180  // backrest angle from horizontal
const BASE_W = DEVICE_W + 14
const BASE_D = 96
const BASE_T = 5
const BACK_H = 95
const WALL = 4
const LIP_H = 14
const SLOT_W = 14        // charging-cable slot in the lip

function main() {
  const base = primitives.roundedCuboid({
    size: [BASE_W, BASE_D, BASE_T], roundRadius: 1.5, segments: 24,
    center: [0, 0, BASE_T / 2],
  })
  // Backrest: plate rotated back, overlapping the base for a solid union.
  let back = primitives.roundedCuboid({
    size: [BASE_W, WALL, BACK_H], roundRadius: 1.5, segments: 24,
    center: [0, 0, BACK_H / 2 - 1],
  })
  back = transforms.rotateX(-(Math.PI / 2 - ANGLE), back)
  back = transforms.translate([0, BASE_D / 2 - WALL - 6, 0], back)
  // Front lip holds the phone; sits DEVICE_T in front of the backrest foot.
  const lipY = BASE_D / 2 - WALL - 6 - DEVICE_T - WALL
  const lip = primitives.roundedCuboid({
    size: [BASE_W, WALL, LIP_H + BASE_T], roundRadius: 1.5, segments: 24,
    center: [0, lipY, (LIP_H + BASE_T) / 2],
  })
  const solid = booleans.union(base, back, lip)
  // Cable slot: cut through the lip and the base directly under it only
  // (scoped in Y so it never weakens the backrest foot).
  const slot = primitives.cuboid({
    size: [SLOT_W, WALL + 8, (LIP_H + BASE_T + 2) * 2],
    center: [0, lipY, 0],
  })
  return booleans.subtract(solid, slot)
}

module.exports = { main }

Output ONLY the JavaScript source. No markdown fences, no prose.`
