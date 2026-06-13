/**
 * Parse a user's natural-language request (plus optional logo image
 * description and chat history) into a structured Design specification.
 *
 * Uses generateText + manual JSON parse + Zod validate. We deliberately
 * avoid generateObject because its tool-schema conversion hits Anthropic's
 * 24-optional-parameters limit on our discriminated union.
 */
import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'
import { Design } from './schema'
import { isMeshyConfigured } from '@/lib/meshy/client'
import { parseImportEdit, type PreviewBundle } from './parse-import'
import type { SemanticFace } from '@/lib/import/types'

export async function parseDesign(input: {
  /** Full chat history including the current user message at the end. */
  messages: string[]
  /** Brief description of the logo image, if one is attached. */
  imageDescription: string | null
  /** Width / height ratio of the logo image (when one is attached). Lets the
   * LLM pick plate dimensions that match the logo's proportions. */
  imageAspectRatio?: number | null
  /**
   * The Design that was last successfully built in this project. When present,
   * the LLM treats the latest message as an iteration ON this design and
   * returns a modified version, not a fresh design parsed in isolation.
   */
  previousDesign?: Design | null
  /**
   * When the user uploaded a .3mf, the route loads base mesh metadata and
   * passes it here so we dispatch to the imported-edit prompt.
   */
  importContext?: {
    baseMeshUrl: string
    faces: SemanticFace[]
    previewDataUrls: PreviewBundle
    bboxMm: [number, number, number]
  }
}): Promise<Design> {
  // Dispatch to the vision LLM when this is an imported-mesh edit session.
  if (input.importContext) {
    return parseImportEdit({
      messages: input.messages,
      baseMeshUrl: input.importContext.baseMeshUrl,
      faces: input.importContext.faces,
      previewDataUrls: input.importContext.previewDataUrls,
      previousDesign: input.previousDesign ?? null,
      bboxMm: input.importContext.bboxMm,
    })
  }

  const { messages, imageDescription, imageAspectRatio, previousDesign } = input
  const last = messages[messages.length - 1] ?? ''
  const earlier = messages.slice(0, -1)
  const earlierBlock = earlier.length
    ? earlier.map((m, i) => `(${i + 1}) ${m}`).join('\n')
    : '(none)'

  const previousBlock = previousDesign
    ? `PREVIOUS DESIGN (output of the last successful build — treat the latest message as a MODIFICATION of this):
${JSON.stringify(previousDesign, null, 2)}`
    : 'PREVIOUS DESIGN: (none — this is the first build in the project)'

  const { text } = await generateText({
    model: await getClassifierModel(),
    system: SYSTEM,
    prompt: `LOGO IMAGE: ${imageDescription ?? '(none attached)'}
LOGO ASPECT RATIO (width/height): ${
      imageAspectRatio
        ? `${imageAspectRatio.toFixed(2)} — ${
            imageAspectRatio > 1.3 ? 'WIDE (use a wide plate)'
            : imageAspectRatio < 0.77 ? 'TALL (use a tall plate)'
            : 'roughly SQUARE (use a square-ish plate)'
          }`
        : '(no image)'
    }

EARLIER MESSAGES (chat context):
${earlierBlock}

${previousBlock}

LATEST MESSAGE (decides the design or modification):
${last}

${isMeshyConfigured()
  ? 'FREEFORM AVAILABLE: if the request is an organic / figurative / irregular object (animal, character, creature, bust, sculpture, toy) that NO primitive fits, output {"kind":"freeform","prompt":"<concise English description optimized for 3D generation>"}.'
  : 'FREEFORM UNAVAILABLE: never output kind:"freeform"; collapse organic requests to the closest primitive.'}

Reply with ONLY valid JSON matching the schema. No markdown, no prose, no \`\`\` fences.`,
    maxOutputTokens: 800,
    abortSignal: AbortSignal.timeout(60_000),
  })

  const first = tryParseDesign(text)
  if (first.ok) return first.design

  // One repair re-ask: hand the model its own bad output + the error and let it
  // correct itself before we give up.
  const { text: repaired } = await generateText({
    model: await getClassifierModel(),
    system: SYSTEM,
    prompt:
      `Your previous reply was not a valid Design JSON.\n` +
      `ERROR: ${first.error}\n` +
      `YOUR PREVIOUS REPLY:\n${text.slice(0, 1000)}\n\n` +
      `Reply again with ONLY valid JSON matching the schema. No markdown, no prose.`,
    maxOutputTokens: 800,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const second = tryParseDesign(repaired)
  if (second.ok) return second.design
  throw new Error(second.error)
}

type ParseAttempt = { ok: true; design: Design } | { ok: false; error: string }

/** Strip optional fenced code wrappers, JSON.parse, then Zod-validate. Returns a
 *  result instead of throwing so the caller can re-ask once on failure. */
function tryParseDesign(text: string): ParseAttempt {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, error: `LLM did not return valid JSON: ${(err as Error).message}\nGot: ${text.slice(0, 200)}` }
  }

  const result = Design.safeParse(json)
  if (!result.success) {
    return { ok: false, error: `LLM JSON did not match Design schema: ${result.error.message}\nGot: ${JSON.stringify(json).slice(0, 300)}` }
  }
  return { ok: true, design: result.data }
}

const SYSTEM = `You convert a user's 3D-print request into a structured Design JSON.

# Iteration mode

If a PREVIOUS DESIGN is provided, the user is iterating. The LATEST MESSAGE will usually be a modification ("logo maior", "make it taller", "tira a alça", "vazada em vez de gravada"). Apply the modification to the PREVIOUS DESIGN and return the FULL updated spec — keep all fields the user didn't change.

Common iterations:
- "logo maior" / "bigger logo"      → increase logo.sizeRatio (e.g., 0.5 → 0.7)
- "logo menor" / "smaller logo"     → decrease logo.sizeRatio
- "vazada" / "vazado" / "passante"  → logo.treatment = "through_cut"
- "gravada" / "baixo relevo"        → logo.treatment = "engraved"
- "alto relevo" / "em relevo"       → logo.treatment = "embossed"
- "mais alto" / "taller"            → increase heightMm
- "mais baixo" / "shorter"          → decrease heightMm
- "tira a alça" / "remove handle"   → omit handle field
- "com alça"                        → add handle with defaults
- "vira para outro lado" / "outro lado" → flip logo.position
- "buraco do lado" / "furo na lateral" / "hole on the side" → hangingHole.position = "left" or "right"
- "buraco no canto" / "hole on the corner" → "top_left" or "top_right"
- "buraco em cima" / "hole on top"  → "top"

If the LATEST MESSAGE describes a COMPLETELY DIFFERENT object (e.g., previous was "porta-lata", now "chaveiro"), discard the PREVIOUS DESIGN and start fresh.



# Output schema

A discriminated union on 'kind'. Pick ONE of:

{ "kind": "hollow_cylinder",
  "insideDiameterMm": <number>, "heightMm": <number>,
  "wallMm": <number, default 3>, "baseMm": <number, default 3>,
  "handle": { "heightMm": <number, default 60>,
              "stickOutMm": <number, default 28>,
              "thicknessMm": <number, default 8>,
              "fingerHoleDiameterMm": <number, default 22> } | omit,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "flat_plate",
  "widthMm": <number>, "heightMm": <number>,
  "thicknessMm": <number, default 4>, "cornerRadiusMm": <number, default 2>,
  "hangingHole": { "diameterMm": <number>,
                   "position": "top" | "top_left" | "top_right" | "left" | "right" | "bottom" } | omit,
  "standAngleDeg": <number, 0..80> | omit,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "box",
  "widthMm": <number>, "depthMm": <number>, "heightMm": <number>,
  "cornerRadiusMm": <number, default 0 — set >0 for rounded edges>,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "disc",
  "diameterMm": <number>,
  "thicknessMm": <number, default 5>,
  "hangingRing":  { "outerDiameterMm": <number>, "innerDiameterMm": <number> } | omit,
  "hangingHole":  { "diameterMm": <number>,
                    "position": "top" | "top_left" | "top_right" | "left" | "right" | "bottom" } | omit,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "composite",
  "parts": [
    { "primitive": { /* FULL primitive object — pick a kind above (hollow_cylinder, flat_plate, disc, or custom_keychain) and include ALL its fields, e.g. {"kind":"disc","diameterMm":80,"thicknessMm":15} */ },
      "offsetZ": <number, where this part's bottom sits in mm>,
      "extruder": "A" | "B" (default "A") },
    ... (2 to 4 parts total)
  ] }
NOTE: parts[i].primitive is an OBJECT (with its own "kind" and dims), NOT a string.

{ "kind": "bookmark",
  "widthMm": <number, default 25>, "heightMm": <number, default 140>,
  "thicknessMm": <number, default 1.2>,
  "hangingHole": { "diameterMm": <number, default 4>,
                   "position": "top" | "bottom" } | omit,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "pin",
  "diameterMm": <number, default 25>, "thicknessMm": <number, default 2>,
  "pinDiameterMm": <number, default 4.5>, "pinHeightMm": <number, default 8>,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "custom_keychain",
  "thicknessMm": <number, default 4>, "paddingMm": <number, default 4>,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }

{ "kind": "mug",
  "insideDiameterMm": <number, default 80>, "heightMm": <number, default 95>,
  "wallMm": <number, default 4>, "baseMm": <number, default 5>,
  "handleHeightMm": <number, default 65>,
  "handleStickOutMm": <number, default 30>,
  "handleThicknessMm": <number, default 10>,
  "logo": { ... } | omit,
  "extruder": "A" | "B" (default "A") }


flat_plate has an extra optional field 'orientation: "flat" | "vertical"'.

{ "kind": "freeform",
  "prompt": "<concise English description optimized for 3D generation>",
  "sourceImageUrl": "<url>" | omit,
  "artStyle": "realistic" | "sculpture" (default "realistic") }
Use "freeform" ONLY for organic / figurative / irregular objects that none of the primitives above can express, and ONLY when the message marks freeform AVAILABLE.
Use "vertical" ONLY for the top piece of a Composite trophy.

# Extruders / Colors (Multi-color)

Every primitive has an 'extruder' field: '"A" | "B"' (default '"A"').
The logo sub-object also has an 'extruder' field: '"A" | "B"' (default '"B"').
By default, the main body uses Extruder "A" and the logo uses Extruder "B" (multi-material print).

# Logo Sub-Object


{ "treatment": "through_cut" | "engraved" | "embossed",
  "position":  "top_face" | "bottom_face" | "front_face" | "wrapped_around",
  "sizeRatio": <number 0.2..0.95, default 0.6>,
  "depthMm":   <number> | omit,
  "binaryThreshold": <number 50..254> | omit,
  "extruder":  "A" | "B" (default "B"),
  "addBridges": <boolean, default false - set to true for through_cut when the logo has letter furos like O, P, A>,
  "texture": "none" | "honeycomb" | "stripes" | "grid" (default "none" - use for textured engravings/embossings) }

# Primitive Selection

- hollow_cylinder — sleeve/holder: porta-lata, porta-copo (sleeve), vases, pen holders.
- mug — caneca com alça: caneca, xícara, mug.
- custom_keychain — chaveiro personalizado cuja base acompanha a silhueta do logo: "chaveiro personalizado", "chaveiro com formato da logo", "chaveiro silhueta".
- flat_plate — rectangular keychains (chaveiro retangular), magnets (ímãs), desk plaques (plaquinha), nameplates.
- disc — round flat things: coasters (porta-copo), medals (medalha), round pendants.
- box — solid rectangular block / cube: "cubo", "caixa", "bloco", "dado", "base sólida retangular". A true 3D volume (width×depth×height). For THIN flat items prefer flat_plate; use box when depth/height matter (a real cube/block). A cube = width = depth = height.
- bookmark — bookmarks (marca-página).
- pin — lapel pins, badges, buttons (pin, botão, badge, broche). Default position is bottom_face and engraved.

# Examples

User: "um cubo de 30mm"
→ {"kind":"box","widthMm":30,"depthMm":30,"heightMm":30,"cornerRadiusMm":0}

User: "uma caixa de 60x40x30mm com cantos arredondados"
→ {"kind":"box","widthMm":60,"depthMm":40,"heightMm":30,"cornerRadiusMm":3}

User: "caneca com a logo"
→ {"kind":"mug","insideDiameterMm":80,"heightMm":95,"wallMm":4,"baseMm":5,"handleHeightMm":65,"handleStickOutMm":30,"handleThicknessMm":10,"logo":{"treatment":"through_cut","position":"front_face","sizeRatio":0.5}}

User: "chaveiro personalizado com a silhueta da logo vazada"
→ {"kind":"custom_keychain","thicknessMm":4,"paddingMm":4,"logo":{"treatment":"through_cut","position":"top_face","sizeRatio":0.8,"addBridges":true}}

User: "chaveiro com a logo em baixo relevo com textura colmeia"
→ {"kind":"flat_plate","widthMm":60,"heightMm":30,"thicknessMm":4,"cornerRadiusMm":4,"hangingHole":{"diameterMm":5,"position":"top"},"logo":{"treatment":"engraved","position":"top_face","sizeRatio":0.7,"texture":"honeycomb"}}

User: "porta-lata pra Monster 473ml com a logo"
→ {"kind":"hollow_cylinder","insideDiameterMm":60,"heightMm":100,"wallMm":3,"baseMm":3,"logo":{"treatment":"through_cut","position":"front_face","sizeRatio":0.5}}

User: "troféu com base redonda e placa em pé com a logo"
→ {"kind":"composite","parts":[
  {"primitive":{"kind":"disc","diameterMm":80,"thicknessMm":15},"offsetZ":0,"extruder":"A"},
  {"primitive":{"kind":"flat_plate","widthMm":70,"heightMm":90,"thicknessMm":5,"cornerRadiusMm":3,"orientation":"vertical","logo":{"treatment":"engraved","position":"top_face","sizeRatio":0.7}},"offsetZ":15,"extruder":"A"}
]}

Output ONLY the JSON object. No markdown, no prose, no code fences.`
