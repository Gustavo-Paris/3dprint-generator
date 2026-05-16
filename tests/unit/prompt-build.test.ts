import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from '@/lib/prompt/system'
import { buildMessages } from '@/lib/prompt/build'

describe('SYSTEM_PROMPT (Phase 1: single-body)', () => {
  it('declares mm as the unit', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('mm')
  })
  it('mandates a main() function with single-body return', () => {
    expect(SYSTEM_PROMPT).toMatch(/main\s*\(\s*\)/)
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('return')
  })
  it('references @jscad/modeling', () => {
    expect(SYSTEM_PROMPT).toContain('@jscad/modeling')
  })
  it('forbids non-JSCAD imports', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/(no|only).*(import|require)/)
  })
})

describe('buildMessages', () => {
  it('returns the system prompt as a separate field', () => {
    const { system, messages } = buildMessages({ history: [], newMessage: 'a cube' })
    expect(system).toContain('@jscad/modeling')
    expect(messages[0]).toMatchObject({ role: 'user', content: 'a cube' })
  })

  it('appends history alternating user/assistant', () => {
    const { messages } = buildMessages({
      history: [
        { userMessage: 'cube', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,10]}); module.exports = { main }' },
        { userMessage: 'taller', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,30]}); module.exports = { main }' },
      ],
      newMessage: 'add a hole',
    })
    expect(messages).toHaveLength(5)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'cube' })
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toContain('cuboid')
    expect(messages[4]).toMatchObject({ role: 'user', content: 'add a hole' })
  })

  it('caps history at the last 10 turns', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      userMessage: `msg ${i}`,
      jscadCode: `// code ${i}`,
    }))
    const { messages } = buildMessages({ history, newMessage: 'next' })
    // 10 user/assistant pairs + 1 new user = 21
    expect(messages).toHaveLength(21)
    expect(messages[0].content).toBe('msg 10')
  })
})
