import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { decompose, buildConnectionGraph } from '@/lib/flexify/decompose'
import { buildJointDonations } from '@/lib/flexify/joints'

let rocktopusMesh: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/rocktopus-reference.3mf')),
  )
  rocktopusMesh = await loadBaseMeshFromBytes(bytes)
})

describe('flexify/joints', () => {
  it('builds one donation per connection', () => {
    const comps = decompose(rocktopusMesh)
    const conns = buildConnectionGraph(rocktopusMesh, comps)
    const donations = buildJointDonations(rocktopusMesh, comps, conns)
    expect(donations.length).toBe(conns.length)
  })

  it('each donation has triangles on both sides', () => {
    const comps = decompose(rocktopusMesh)
    const conns = buildConnectionGraph(rocktopusMesh, comps)
    const donations = buildJointDonations(rocktopusMesh, comps, conns)
    for (const d of donations) {
      expect(d.socketTriangles.length).toBeGreaterThan(0)
      expect(d.ballTriangles.length).toBeGreaterThan(0)
    }
  })

  it('donation radius respects min/max bounds', () => {
    const comps = decompose(rocktopusMesh)
    const conns = buildConnectionGraph(rocktopusMesh, comps)
    const donations = buildJointDonations(rocktopusMesh, comps, conns, {
      minRadiusMm: 1.5,
      maxRadiusMm: 6,
    })
    for (const d of donations) {
      expect(d.radius).toBeGreaterThanOrEqual(1.5)
      expect(d.radius).toBeLessThanOrEqual(6)
    }
  })

  it('donations near the body are larger than donations at tentacle tips', () => {
    const comps = decompose(rocktopusMesh)
    const conns = buildConnectionGraph(rocktopusMesh, comps)
    const donations = buildJointDonations(rocktopusMesh, comps, conns)
    // body-adjacent joints have socketComponentId == 0
    const bodyJoints = donations.filter((d, i) => conns[i].socketComponentId === 0)
    // The largest donation radii should belong to body joints since the body
    // dictates clearance for the first tentacle segments.
    const maxBodyRadius = Math.max(...bodyJoints.map((d) => d.radius))
    const maxAllRadius = Math.max(...donations.map((d) => d.radius))
    expect(maxBodyRadius).toBeCloseTo(maxAllRadius, 1)
  })
})
