import { SYSTEM_PROMPT } from './system'

export type HistoryTurn = {
  userMessage: string
  jscadCode: string | null
}

export type ConversationMessage = { role: 'user' | 'assistant'; content: string }

export type PromptInput = {
  system: string
  messages: ConversationMessage[]
}

const MAX_HISTORY_TURNS = 10

/**
 * Build the prompt input for streamText. The system prompt is returned as a
 * separate field — AI SDK v6 warns against putting system messages inside the
 * messages array because of prompt-injection risk.
 */
export function buildMessages(input: {
  history: HistoryTurn[]
  newMessage: string
}): PromptInput {
  const recent = input.history.slice(-MAX_HISTORY_TURNS)
  const messages: ConversationMessage[] = []
  for (const turn of recent) {
    messages.push({ role: 'user', content: turn.userMessage })
    if (turn.jscadCode !== null) {
      messages.push({ role: 'assistant', content: turn.jscadCode })
    }
  }
  messages.push({ role: 'user', content: input.newMessage })
  return { system: SYSTEM_PROMPT, messages }
}
