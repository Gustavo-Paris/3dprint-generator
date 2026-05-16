import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'
import { z } from 'zod'

const TransformSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scale'), x: z.number(), y: z.number(), z: z.number() }),
  z.object({ type: z.literal('rotate'), axis: z.enum(['x', 'y', 'z']), degrees: z.number() }),
  z.object({ type: z.literal('mirror'), axis: z.enum(['x', 'y', 'z']) }),
  z.object({ type: z.literal('translate'), x: z.number(), y: z.number(), z: z.number() }),
])

export type Transform = z.infer<typeof TransformSchema>

const IntentSchema = z.object({
  mode: z.enum(['transform', 'regenerate']),
  transforms: z.array(TransformSchema).default([]),
  reason: z.string().optional(),
})

export type IterationIntent = z.infer<typeof IntentSchema>

const SYSTEM = `You decide how to handle a user follow-up message in a 3D-print-generator chat.
The user has already generated a 3D model and is now sending an edit instruction.

Two modes:
- "transform": user wants a simple geometric edit applicable to the existing mesh
  (scale, rotate, mirror, translate). Examples: "deixa mais alto", "metade do tamanho",
  "rotaciona 90 graus em Z", "espelha", "20% maior"
- "regenerate": user wants a fundamental change requiring a new 3D generation.
  Examples: "vazado nas letras", "mais elaborado", "adiciona detalhe", "outro estilo",
  "logo diferente"

Output JSON. Always include "mode". If mode="transform", also include "transforms"
array with the geometric operations. Transforms are applied in order.

Supported transforms (use exactly these shapes):
  { "type": "scale", "x": <factor>, "y": <factor>, "z": <factor> }      // e.g. 1.5 = 150%
  { "type": "rotate", "axis": "x"|"y"|"z", "degrees": <number> }
  { "type": "mirror", "axis": "x"|"y"|"z" }
  { "type": "translate", "x": <mm>, "y": <mm>, "z": <mm> }

For "deixa mais alto" → scale Z by 1.5 (default boost when no value given)
For "metade do tamanho" → scale all by 0.5
For "espelha" → mirror X
For "rotaciona" without axis → rotate Z by 90

Output ONLY the JSON object, no prose. Example:
{"mode":"transform","transforms":[{"type":"scale","x":1,"y":1,"z":1.5}],"reason":"taller"}`

/**
 * Ask Haiku to classify an iteration message as a geometric transform (cheap,
 * server-side) or a regeneration (expensive, Meshy call). Returns the parsed
 * intent + transform list.
 *
 * Falls back to `regenerate` on any error — safer to call Meshy than to
 * silently transform when we're not sure what the user meant.
 */
export async function parseIterationIntent(userMessage: string): Promise<IterationIntent> {
  try {
    const { text } = await generateText({
      model: getClassifierModel(),
      system: SYSTEM,
      prompt: userMessage,
      maxOutputTokens: 200,
    })

    // Strip markdown code fences if the model adds them
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    const validated = IntentSchema.safeParse(parsed)
    if (!validated.success) return { mode: 'regenerate', transforms: [] }
    return validated.data
  } catch {
    return { mode: 'regenerate', transforms: [] }
  }
}
