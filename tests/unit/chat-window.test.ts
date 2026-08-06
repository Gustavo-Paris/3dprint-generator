import { describe, it, expect } from 'vitest'
import { CHAT_VISIBLE_WINDOW } from '@/lib/chat/window'

describe('CHAT_VISIBLE_WINDOW', () => {
  it('is a positive window size for long histories', () => {
    expect(CHAT_VISIBLE_WINDOW).toBeGreaterThanOrEqual(20)
    expect(CHAT_VISIBLE_WINDOW).toBeLessThanOrEqual(100)
  })
})
