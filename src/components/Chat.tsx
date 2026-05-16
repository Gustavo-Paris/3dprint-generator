'use client'
import { useState } from 'react'

type Msg = {
  role: 'user' | 'assistant'
  text: string
  iterationId?: string
  strategy?: 'parametric' | 'generative'
}

export type ChatResult =
  | { kind: 'parametric'; iterationId: string; code: string }
  | { kind: 'generative'; iterationId: string; meshUrl: string | null; meshBase64: string | null }

export default function Chat({
  projectId,
  initial,
  onResult,
}: {
  projectId: string
  initial: Msg[]
  onResult: (r: ChatResult) => void
}) {
  const [messages, setMessages] = useState<Msg[]>(initial)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!draft.trim() || busy) return
    const userText = draft.trim()
    setMessages((m) => [...m, { role: 'user', text: userText }])
    setDraft('')
    setBusy(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, message: userText }),
      })
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
      const body = (await res.json()) as
        | { strategy: 'parametric'; iteration_id: string; jscad_code: string }
        | {
            strategy: 'generative'
            iteration_id: string
            mesh_url: string | null
            mesh_base64: string | null
            meta: { task_id: string; took_ms: number }
          }

      if (body.strategy === 'parametric') {
        setMessages((m) => [
          ...m,
          { role: 'assistant', text: body.jscad_code, iterationId: body.iteration_id, strategy: 'parametric' },
        ])
        onResult({ kind: 'parametric', iterationId: body.iteration_id, code: body.jscad_code })
      } else {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Generated via Meshy in ${(body.meta.took_ms / 1000).toFixed(0)}s`,
            iterationId: body.iteration_id,
            strategy: 'generative',
          },
        ])
        onResult({
          kind: 'generative',
          iterationId: body.iteration_id,
          meshUrl: body.mesh_url,
          meshBase64: body.mesh_base64,
        })
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm" data-testid="chat-history">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block rounded px-3 py-2 max-w-[90%] ${
                m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100 font-mono text-xs whitespace-pre-wrap'
              }`}
            >
              {m.text}
            </div>
            {m.role === 'assistant' && m.strategy && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-700 uppercase align-top">
                {m.strategy === 'generative' ? 'meshy' : 'jscad'}
              </span>
            )}
          </div>
        ))}
        {busy && <div className="text-gray-400 text-xs">Generating…</div>}
      </div>
      <form
        className="p-4 border-t flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe what to build..."
          className="flex-1 border rounded px-3 py-2"
          disabled={busy}
          data-testid="chat-input"
        />
        <button type="submit" className="bg-black text-white rounded px-4 py-2 disabled:opacity-50" disabled={busy}>
          Send
        </button>
      </form>
    </>
  )
}
