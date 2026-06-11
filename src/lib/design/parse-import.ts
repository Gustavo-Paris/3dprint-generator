/**
 * parseImportEdit — vision LLM call specialised for imported-mesh edits.
 *
 * Takes user messages, semantic face metadata, and 4-angle preview images,
 * then calls the Opus model to produce a validated `Design` with kind="imported".
 */
import { generateText } from 'ai'
import { getModel } from '@/lib/llm/model'
import { Design } from './schema'
import type { Design as DesignType } from './schema'
import type { SemanticFace } from '@/lib/import/types'

export interface PreviewBundle {
  /** data URL or blob URL of the top-down view */
  top: string
  /** data URL or blob URL of the front view */
  front: string
  /** data URL or blob URL of the right-side view */
  right: string
  /** data URL or blob URL of the isometric view */
  iso: string
}

export interface ParseImportEditInput {
  /** All user messages in the conversation, oldest first. */
  messages: string[]
  /** The URL of the uploaded .3mf base mesh. */
  baseMeshUrl: string
  /** Semantic faces computed by face-segment.ts — top-12 by area. */
  faces: SemanticFace[]
  /** 4-angle PNG screenshots captured by the client's MeshViewer. */
  previewDataUrls: PreviewBundle
  /** Previous design to treat as a base for modifications (or null for first edit). */
  previousDesign: DesignType | null
  /** Global bounding box of the mesh in mm: [width, depth, height]. */
  bboxMm: [number, number, number]
}

/**
 * Call the Opus vision model to interpret the user's edit request in the
 * context of the mesh's face geometry and preview images.
 *
 * @throws If the model returns bad JSON or a schema-invalid response.
 */
export async function parseImportEdit(input: ParseImportEditInput): Promise<DesignType> {
  const { messages, baseMeshUrl, faces, previewDataUrls, previousDesign, bboxMm } = input
  const last = messages[messages.length - 1] ?? ''
  const earlier = messages.slice(0, -1)

  const faceTable = faces.map((f) =>
    `F${f.id}: ${faceDirection(f.normal)} ` +
    `normal=[${f.normal.map((c) => c.toFixed(2)).join(',')}] ` +
    `centroid=[${f.centroid.map((c) => c.toFixed(1)).join(',')}] ` +
    `area=${f.areaMm2.toFixed(0)}mm² ` +
    `bboxOnPlane={x:${f.bboxOnPlane.min[0].toFixed(1)}..${f.bboxOnPlane.max[0].toFixed(1)},` +
    `y:${f.bboxOnPlane.min[1].toFixed(1)}..${f.bboxOnPlane.max[1].toFixed(1)}}`,
  ).join('\n')

  const previousBlock =
    previousDesign && previousDesign.kind === 'imported'
      ? `PREVIOUS DESIGN (treat new message as a modification):\n${JSON.stringify(previousDesign, null, 2)}`
      : '(first edit on this mesh)'

  const userPrompt =
    `You are editing an imported 3D mesh. Output a Design JSON with kind="imported".\n\n` +
    `BASE MESH:\n` +
    `- url: ${baseMeshUrl}\n` +
    `- bbox: ${bboxMm[0].toFixed(1)} × ${bboxMm[1].toFixed(1)} × ${bboxMm[2].toFixed(1)} mm\n\n` +
    `SEMANTIC FACES (top by area, use 'faceId' to reference):\n` +
    (faceTable || '(no faces detected)') +
    `\n\nFACE DIRECTIONS — each face is tagged FRONT/BACK/LEFT/RIGHT/TOP/BOTTOM ` +
    `from its normal in the standard orientation: FRONT=toward the viewer (−Y), ` +
    `BACK=+Y, RIGHT=+X, LEFT=−X, TOP=+Z, BOTTOM=−Z. Map the user's words: ` +
    `"frente/frontal/front"→FRONT, "trás/atrás/costas/back"→BACK, ` +
    `"lado/lateral/side"→LEFT or RIGHT, "topo/cima/top"→TOP, ` +
    `"base/pedestal/pé/embaixo/bottom" refers to the LOWER part → among matching ` +
    `faces prefer the one with the most negative Z centroid. ` +
    `IMPORTANT: the preview images are NOT axis-aligned — trust these direction ` +
    `tags and the normals over the images when choosing a face.\n\n` +
    `EARLIER MESSAGES:\n` +
    (earlier.length ? earlier.map((m, i) => `(${i + 1}) ${m}`).join('\n') : '(none)') +
    `\n\n${previousBlock}\n\n` +
    `LATEST MESSAGE:\n${last}\n\n` +
    `Reply ONLY with valid JSON: { "kind": "imported", "baseMeshUrl": "${baseMeshUrl}", "edits": [...] }`

  const { text } = await generateText({
    model: getModel(),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image', image: previewDataUrls.iso },
          { type: 'image', image: previewDataUrls.top },
          { type: 'image', image: previewDataUrls.front },
          { type: 'image', image: previewDataUrls.right },
        ],
      },
    ],
    maxOutputTokens: 1200,
    abortSignal: AbortSignal.timeout(60_000),
  })

  const first = tryParseImport(text)
  if (first.ok) return first.design

  // One repair re-ask, text-only (the bad output + error is enough; no need to
  // re-send the preview images).
  const { text: repaired } = await generateText({
    model: getModel(),
    system: SYSTEM,
    prompt:
      `Your previous reply was not a valid imported-edit JSON.\n` +
      `ERROR: ${first.error}\n` +
      `YOUR PREVIOUS REPLY:\n${text.slice(0, 1000)}\n\n` +
      `Reply again with ONLY valid JSON: { "kind": "imported", "baseMeshUrl": "${baseMeshUrl}", "edits": [...] }. No markdown, no prose.`,
    maxOutputTokens: 1200,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const second = tryParseImport(repaired)
  if (second.ok) return second.design
  throw new Error(second.error)
}

type ImportAttempt = { ok: true; design: DesignType } | { ok: false; error: string }

/** Strip fences, JSON.parse, Zod-validate — returns a result instead of throwing
 *  so the caller can re-ask once on failure. */
function tryParseImport(text: string): ImportAttempt {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, error: `parseImportEdit: bad JSON: ${(err as Error).message}\nGot: ${text.slice(0, 300)}` }
  }

  const result = Design.safeParse(json)
  if (!result.success) {
    return { ok: false, error: `parseImportEdit: schema mismatch: ${result.error.message}` }
  }
  return { ok: true, design: result.data }
}

const SYSTEM = `You edit an existing 3D mesh by emitting a list of structured operations.

# Output

Always emit a JSON object with kind="imported", echoing the provided baseMeshUrl, and an "edits" array.

# Available ops

{ "op": "scale", "factor": <number or {x,y,z}> }
{ "op": "hole", "faceId": <int>, "shape": "circle"|"rect",
  "diameterMm": <number> (circle), "widthMm"/"heightMm": <number> (rect),
  "depthMm": <number> | "through", "positions": [[u, v], ...] }
{ "op": "add_logo", "faceId": <int>, "imageUrl": <url>,
  "sizeMm": <number>, "depthMm": <number>,
  "treatment": "embossed"|"engraved"|"through_cut", "offsetMm": [u,v] }
{ "op": "emboss_text", "faceId": <int>, "text": <string>,
  "treatment": "embossed"|"engraved",
  "sizeMm": <number>, "depthMm": <number>, "offsetMm": [u,v] }
{ "op": "jscad_raw", "mode": "union"|"replace",
  "code": "module.exports={main:(current)=>{...}}" }

# Face references

Use the F0/F1/... ids from the SEMANTIC FACES list. Each face carries a
direction tag (FRONT/BACK/LEFT/RIGHT/TOP/BOTTOM) — match the user's words to it,
and trust the tag + normal over the preview images (which are not axis-aligned).
(u, v) coordinates in "positions" or "offsetMm" are in the face's tangent
plane, centered on the face centroid, in millimetres.

# When to use jscad_raw

Only when the request can't fit the structured ops (e.g. "twist the top
30 degrees", "shell the mesh with 2mm walls"). The code receives the
current mesh as a Geom3 in "replace" mode, or you emit fresh geometry
that gets unioned in "union" mode.

# Iteration

If a PREVIOUS DESIGN is given, treat the latest message as a modification.
Patch the relevant edit (e.g. change positions, increase depth) rather
than rebuilding from scratch.

Output ONLY the JSON. No prose, no markdown fences.`

/**
 * Tag a face with a human direction from its dominant normal axis, in the
 * viewer's standard orientation: FRONT faces the default camera (−Y), BACK +Y,
 * RIGHT +X, LEFT −X, TOP +Z, BOTTOM −Z. The captured preview images are not
 * axis-aligned (the viewer rotates the mesh −90° about X), so the LLM mislabels
 * faces from images alone — these tags give it a reliable signal instead.
 */
function faceDirection(normal: readonly [number, number, number]): string {
  const [x, y, z] = normal
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z)
  if (az >= ax && az >= ay) return z > 0 ? 'TOP' : 'BOTTOM'
  if (ay >= ax) return y > 0 ? 'BACK' : 'FRONT'
  return x > 0 ? 'RIGHT' : 'LEFT'
}
