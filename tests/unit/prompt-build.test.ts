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
  it('starts with the system prompt', () => {
    const msgs = buildMessages({ history: [], newMessage: 'a cube' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('@jscad/modeling')
  })

  it('appends history alternating user/assistant', () => {
    const msgs = buildMessages({
      history: [
        { userMessage: 'cube', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,10]}); module.exports = { main }' },
        { userMessage: 'taller', jscadCode: 'const main = () => jscad.primitives.cuboid({size:[10,10,30]}); module.exports = { main }' },
      ],
      newMessage: 'add a hole',
    })
    expect(msgs).toHaveLength(6)
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'cube' })
    expect(msgs[2].role).toBe('assistant')
    expect(msgs[2].content).toContain('cuboid')
    expect(msgs[5]).toMatchObject({ role: 'user', content: 'add a hole' })
  })

  it('caps history at the last 10 turns', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      userMessage: `msg ${i}`,
      jscadCode: `// code ${i}`,
    }))
    const msgs = buildMessages({ history, newMessage: 'next' })
    expect(msgs).toHaveLength(22)
    expect(msgs[1].content).toBe('msg 10')
  })
})
