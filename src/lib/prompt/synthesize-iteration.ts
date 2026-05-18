import { generateText } from 'ai'
import { getClassifierModel } from '@/lib/llm/model'

/**
 * Synthesize a Meshy text-to-3D prompt from an image description + chat history.
 *
 * Kept deliberately lightweight: ONE small system prompt, no object-specific
 * dictionaries. The user's latest message decides what kind of object (chaveiro,
 * trofeu, pingente, plaquinha, etc.), and the image is the visual/branding
 * reference for the logo to embed.
 *
 * Returns a single paragraph prompt for Meshy.
 */
export async function synthesizeIterationPrompt(input: {
  imageDescription: string
  messages: string[]
}): Promise<string> {
  const { imageDescription, messages } = input
  if (messages.length === 0) return imageDescription

  const lastMessage = messages[messages.length - 1]
  const earlierMessages = messages.slice(0, -1)
  const earlierBlock = earlierMessages.length
    ? earlierMessages.map((m, i) => `(${i + 1}) ${m}`).join('\n')
    : '(none)'

  const { text } = await generateText({
    model: getClassifierModel(),
    system: `You write a single prompt for Meshy text-to-3D from a user request + a logo description.

Inputs:
  - LOGO: description of the user's uploaded image (their brand/logo, used as the visual reference).
  - EARLIER MESSAGES: context only.
  - LATEST MESSAGE: decides WHAT KIND OF OBJECT the user wants (keychain, trophy, pendant, plaque, magnet, etc.) and any specific properties (size, holes, base, etc.).

Rules:
  - The LATEST MESSAGE defines the object type. The LOGO defines the surface design / shape reference.
  - Translate Portuguese terms literally: "vazado" → through-hole (cutout passing fully through); "chaveiro" → keychain with a small hole at top for a ring; "pingente" → pendant; "trofeu" → trophy; "placa" → flat plaque.
  - Be concrete: name the object form, the dominant axis (flat / vertical / horizontal), the location of the logo on the object, and any holes/cutouts.
  - Default to single-sided design unless the user asks for double-sided. Say "front face has the design; back face is plain and flat" to discourage Meshy from mirroring.
  - Skip color references (Meshy ignores color).
  - Output: one paragraph, 30-70 words, English. No quotes, no preamble.

Examples:
  - LOGO "PG monogram, intertwined serif letters" + LATEST "quero um chaveiro com a logo em 3d" →
    "A flat keychain plaque shaped as the intertwined PG monogram, with a small circular hole at the top edge for the keyring loop. The front face shows the bold serif letterforms in relief; the back face is plain and flat."
  - LOGO "circular brain logo" + LATEST "pingente, com a logo vazada" →
    "A round pendant with the brain logo silhouette cut all the way through as a true through-hole, plus a small hole at the top for a necklace cord. Single-sided design: front face has the relief contour; back is plain."
  - LOGO "shield with crest" + LATEST "trofeu desktop pequeno com a logo" →
    "A small desktop trophy: vertical shield-shaped front plate featuring the crest logo in relief, mounted on a short rectangular base. The trophy stands roughly twice as tall as it is wide; back face of the shield is plain."`,
    prompt: `LOGO:
${imageDescription}

EARLIER MESSAGES:
${earlierBlock}

LATEST MESSAGE (decides what to build):
${lastMessage}`,
    maxOutputTokens: 250,
  })

  return text.trim()
}
