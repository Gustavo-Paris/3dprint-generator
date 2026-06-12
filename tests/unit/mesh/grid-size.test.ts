import { describe, it, expect } from 'vitest'
import { gridSizeFromExtent } from '@/components/MeshViewer'

describe('gridSizeFromExtent', () => {
  it('returns the tight Meshy-scale grid for sub-unit extents', () => {
    expect(gridSizeFromExtent(0.8)).toBe(4)
  })

  it('snaps to 50mm steps and clamps to [50, 1000] for mm-scale meshes', () => {
    // ceil((100 * 2.5) / 50) * 50 = ceil(5) * 50 = 250
    expect(gridSizeFromExtent(100)).toBe(250)
    // tiny but >=1: clamps up to the 50 floor
    expect(gridSizeFromExtent(1)).toBe(50)
    // huge: clamps down to the 1000 ceiling
    expect(gridSizeFromExtent(5000)).toBe(1000)
  })
})
