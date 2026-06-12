import { describe, it, expect } from 'vitest'
import { paginate, PAGE_SIZE } from '@/lib/projects/paginate'

describe('paginate', () => {
  it('defaults to page 1, offset 0', () => {
    expect(paginate(undefined, 100)).toMatchObject({ page: 1, offset: 0, limit: PAGE_SIZE, hasPrev: false, hasNext: true })
  })

  it('clamps non-numeric / out-of-range page to 1', () => {
    expect(paginate('abc', 100).page).toBe(1)
    expect(paginate('0', 100).page).toBe(1)
    expect(paginate('-5', 100).page).toBe(1)
  })

  it('computes offset and hasNext/hasPrev', () => {
    const p = paginate('2', 100)
    expect(p).toMatchObject({ page: 2, offset: PAGE_SIZE, hasPrev: true, hasNext: true })
  })

  it('hasNext is false on the last page', () => {
    const total = PAGE_SIZE + 1
    const last = paginate('2', total)
    expect(last.hasNext).toBe(false)
    expect(last.hasPrev).toBe(true)
  })
})
