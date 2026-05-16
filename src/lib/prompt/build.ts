import { SYSTEM_PROMPT } from './system'

export type HistoryTurn = {
  userMessage: string
  jscadCode: string | null
}

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

const MAX_HISTORY_TURNS = 10

export function buildMessages(input: {
  history: HistoryTurn[]
  newMessage: string
}): Message[] {
  const recent = input.history.slice(-MAX_HISTORY_TURNS)
  const msgs: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of recent) {
    msgs.push({ role: 'user', content: turn.userMessage })
    if (turn.jscadCode !== null) {
      msgs.push({ role: 'assistant', content: turn.jscadCode })
    }
  }
  msgs.push({ role: 'user', content: input.newMessage })
  return msgs
}
