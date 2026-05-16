import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'

const CLASSIFIER_PROMPT = `You classify 3D-print requests as either:
- p = parametric/functional/geometric (cubes, brackets, vases, hooks, organizers, tools, anything that can be built from primitives + boolean operations)
- g = generative/figurative/organic (characters, masks, helmets, miniatures, sculptures, animals, anything requiring sculpted free-form surfaces)

Respond with exactly one character: p or g. No explanation.`

export async function classifyIntent(userMessage: string): Promise<'parametric' | 'generative'> {
  try {
    const { text } = await generateText({
      model: getClassifierModel(),
      system: CLASSIFIER_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 4,
    })
    const c = text.trim().toLowerCase().charAt(0)
    return c === 'g' ? 'generative' : 'parametric'
  } catch {
    return 'parametric'
  }
}
