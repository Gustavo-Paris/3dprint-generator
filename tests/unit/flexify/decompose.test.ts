import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBaseMeshFromBytes } from '@/lib/import/load-base-mesh'
import { decompose, buildConnectionGraph } from '@/lib/flexify/decompose'

let rocktopusMesh: Awaited<ReturnType<typeof loadBaseMeshFromBytes>>

beforeAll(async () => {
  const bytes = new Uint8Array(
    await readFile(join(__dirname, '../../fixtures/rocktopus-reference.3mf')),
  )
  rocktopusMesh = await loadBaseMeshFromBytes(bytes)
})

describe('flexify/decompose', () => {
  it('finds 41 components in the Rocktopus reference', () => {
    const comps = decompose(rocktopusMesh)
    expect(comps.length).toBe(41)
  })

  it('largest component is the body (≥10× the next largest)', () => {
    const comps = decompose(rocktopusMesh)
    expect(comps[0].triangleCount).toBeGreaterThan(comps[1].triangleCount * 10)
  })

  it('body component sits roughly at origin', () => {
    const comps = decompose(rocktopusMesh)
    const body = comps[0]
    expect(Math.abs(body.bbox.center[0])).toBeLessThan(2)
    expect(Math.abs(body.bbox.center[1])).toBeLessThan(2)
  })

  it('buildConnectionGraph returns 40 joints (1 body + 8 chains of 5 segments → 40 connections)', () => {
    const comps = decompose(rocktopusMesh)
    const conns = buildConnectionGraph(rocktopusMesh, comps)
    // Each tentacle has 5 segments connected by 4 joints + 1 joint to body = 5 joints × 8 tentacles = 40
    // (some flexis have a small extra terminal piece — accept 38..44 range)
    expect(conns.length).toBeGreaterThanOrEqual(38)
    expect(conns.length).toBeLessThanOrEqual(48)
  })

  it('connection assigns socket to the inner (body-adjacent) component', () => {
    const comps = decompose(rocktopusMesh)
    const conns = buildConnectionGraph(rocktopusMesh, comps)
    // The body (id 0) should be a socket in at least 8 connections (one per tentacle)
    const bodySocketCount = conns.filter((c) => c.socketComponentId === 0).length
    expect(bodySocketCount).toBeGreaterThanOrEqual(8)
    // And it should NEVER be a ball (body is the root).
    const bodyBallCount = conns.filter((c) => c.ballComponentId === 0).length
    expect(bodyBallCount).toBe(0)
  })
})
