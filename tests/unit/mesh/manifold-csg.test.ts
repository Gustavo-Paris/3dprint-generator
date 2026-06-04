import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { booleanSoup } from '@/lib/import/manifold-csg'
import { analyzeMeshValidity } from '@/lib/mesh/validity'

/** A correctly-wound, watertight axis-aligned box as a triangle soup
 *  (9 floats / triangle), centred at [cx,cy,cz]. */
function boxSoup(w: number, h: number, d: number, cx = 0, cy = 0, cz = 0): Float32Array {
  const geo = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(cx, cy, cz)
  return new Float32Array(geo.getAttribute('position').array as ArrayLike<number>)
}

describe('booleanSoup (Manifold backend)', () => {
  it('subtracts a bar through a cube and returns a watertight solid', async () => {
    const cube = boxSoup(10, 10, 10)
    const bar = boxSoup(4, 4, 30) // pierces clean through Z → tunnel
    const out = await booleanSoup(cube, bar, 'subtract')

    expect(out.length).toBeGreaterThan(0)
    // The result must remain a closed solid the slicer can use.
    const report = analyzeMeshValidity(out)
    expect(report.watertight).toBe(true)
    // A tunnel adds geometry vs the original 12-triangle cube.
    expect(report.triangleCount).toBeGreaterThan(12)
  }, 30_000)

  it('unions two overlapping cubes into one watertight solid', async () => {
    const out = await booleanSoup(boxSoup(10, 10, 10), boxSoup(10, 10, 10, 6, 0, 0), 'union')
    expect(analyzeMeshValidity(out).watertight).toBe(true)
  }, 30_000)

  it('throws when the base is not a closed manifold (open surface)', async () => {
    const openTriangle = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
    await expect(booleanSoup(openTriangle, boxSoup(2, 2, 2), 'subtract')).rejects.toThrow(
      /manifold|watertight/i,
    )
  }, 30_000)
})
