import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'

/**
 * Synthesize an iteration prompt for Meshy text-to-3D.
 *
 * Combines the description of the user's original image with the chronological
 * conversation history into a single rich prompt that captures the cumulative
 * intent. Meshy image-to-3D is stateless and doesn't accept text, so when a
 * user iterates without re-uploading, we switch to text-to-3D and feed the
 * synthesized prompt instead.
 *
 * Returns a single coherent sentence-or-two prompt, not a chat transcript.
 */
export async function synthesizeIterationPrompt(input: {
  imageDescription: string
  messages: string[]
}): Promise<string> {
  const { imageDescription, messages } = input

  if (messages.length === 0) return imageDescription

  const messagesBlock = messages
    .map((m, i) => `(${i + 1}) ${m}`)
    .join('\n')

  const { text } = await generateText({
    model: getClassifierModel(),
    system: `You are merging a 3D-printing iteration history into a single optimized prompt.

You'll receive:
  - Description of the user's source image (the object they want printed)
  - Numbered chronological list of the user's chat messages describing what they want

Output a SINGLE optimized prompt for Meshy text-to-3D generation that captures the
cumulative intent of all messages. The prompt should be specific about:
  - The object (from image description)
  - Any modifications mentioned across messages (size, shape adjustments, additions, details)
  - The latest message takes precedence on conflicts

Output ONLY the final prompt — no JSON, no explanations, no quotes.
Keep it under 80 words.

Example:
  image: "PG monogram in red, stylized serif letters"
  messages:
    (1) trofeu da nossa logo
    (2) vazado nas letras, mais elaborado
    (3) base hexagonal
  → "A real-size trophy featuring an elaborate PG monogram in stylized serif lettering with hollow cutout interiors on each letter, mounted on a hexagonal stepped base."`,
    prompt: `Image description: ${imageDescription}

Messages history:
${messagesBlock}`,
    maxOutputTokens: 250,
  })

  return text.trim()
}
