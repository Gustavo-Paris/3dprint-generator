import { describe, it, expect } from 'vitest'
import { findOrphans } from '@/lib/storage/orphans'

describe('findOrphans', () => {
  it('flags disk files not referenced by any iteration mesh url', () => {
    const disk = ['a.stl', 'b.3mf', 'c.stl']
    const referenced = ['/meshes/a.stl', 'https://blob.example.com/x/y/b.3mf']
    expect(findOrphans(disk, referenced)).toEqual(['c.stl'])
  })
  it('matches blob urls by trailing basename', () => {
    expect(findOrphans(['i.3mf'], ['https://blob.example.com/u/p/i.3mf'])).toEqual([])
  })
})
