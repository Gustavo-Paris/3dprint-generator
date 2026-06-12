import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'
import { resolveInsidePublic } from '@/lib/http/resolve-inside-public'
import { readFile } from 'node:fs/promises'

/**
 * Describe an image in 1-3 sentences optimized for use as a 3D-generation prompt.
 *
 * Used when the user has previously uploaded an image and is iterating on it
 * via text-only follow-ups: we feed the description + the user's accumulated
 * messages to Meshy text-to-3D, since image-to-3D is stateless and doesn't
 * accept prompts.
 *
 * Reads the image from disk (when URL is /uploads/...) and inlines as a data
 * URL for vision-capable models. Public URLs are passed through as-is.
 */
export async function describeImage(imageUrl: string): Promise<string> {
  let resolvedUrl: string

  if (imageUrl.startsWith('http')) {
    resolvedUrl = imageUrl
  } else if (imageUrl.startsWith('/uploads/')) {
    const filePath = resolveInsidePublic(imageUrl)
    const bytes = await readFile(filePath)
    const ext = imageUrl.split('.').pop()?.toLowerCase() ?? 'png'
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    resolvedUrl = `data:${mime};base64,${bytes.toString('base64')}`
  } else {
    throw new Error(`Unrecognized imageUrl for description: ${imageUrl}`)
  }

  const { text } = await generateText({
    model: getClassifierModel(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Describe this image in 1-3 sentences optimized for use as a 3D-printing prompt.
Focus on: shape, key visual elements, text/letters (if any), colors, style.
Be specific but concise. Output ONLY the description, no preamble.

Example output: "A stylized PG monogram with intertwined Paris Group letters in red, set in a rectangular black panel, bold serif lettering."`,
          },
          { type: 'image', image: resolvedUrl },
        ],
      },
    ],
    maxOutputTokens: 200,
    abortSignal: AbortSignal.timeout(60_000),
  })

  return text.trim()
}
