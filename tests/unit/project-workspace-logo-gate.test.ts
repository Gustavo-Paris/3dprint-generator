import { describe, it, expect } from 'vitest'
import {
  buildLogoPlacementBody,
  hasImportedBase,
  hasLogoBase,
  latestLogoBaseMeshUrl,
  suggestedLogoSizeMm,
} from '@/components/ProjectWorkspace'

const it_ = (over: Record<string, unknown>) =>
  ({ validationReport: null, ...over }) as never

describe('hasImportedBase', () => {
  it('true when a fresh .3mf is pending', () => {
    expect(hasImportedBase([], 'blob://mesh.3mf')).toBe(true)
  })
  it('true when history has an imported design', () => {
    const history = [it_({ validationReport: { kind: 'imported', baseMeshUrl: '/x.3mf' } })]
    expect(hasImportedBase(history, null)).toBe(true)
  })
  it('false for a purely parametric project', () => {
    const history = [it_({ validationReport: { kind: 'flat_plate', widthMm: 80 } })]
    expect(hasImportedBase(history, null)).toBe(false)
  })
})

describe('hasLogoBase (rm-009 freeform + logo)', () => {
  it('true for freeform ready row with meshBlobUrl', () => {
    const history = [
      it_({
        status: 'ready',
        meshBlobUrl: '/meshes/free.stl',
        validationReport: { kind: 'freeform', prompt: 'dragon' },
      }),
    ]
    expect(hasLogoBase(history, null)).toBe(true)
    expect(hasImportedBase(history, null)).toBe(false)
    expect(latestLogoBaseMeshUrl(history, null)).toBe('/meshes/free.stl')
  })

  it('true for flexified rows', () => {
    const history = [
      it_({
        status: 'ready',
        meshBlobUrl: '/meshes/flexi.3mf',
        validationReport: { kind: 'flexified' },
      }),
    ]
    expect(hasLogoBase(history, null)).toBe(true)
  })

  it('false for parametric without mesh', () => {
    const history = [
      it_({
        status: 'ready',
        meshBlobUrl: null,
        validationReport: { kind: 'flat_plate', widthMm: 40 },
      }),
    ]
    expect(hasLogoBase(history, null)).toBe(false)
  })
})

describe('buildLogoPlacementBody', () => {
  const logoPlacement = {
    point: [0, 0, 10] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    treatment: 'engraved' as const,
    sizeMm: 20,
    depthMm: 1,
  }

  it('forwards pending mesh + previews + image (fresh .3mf path)', () => {
    const previews = { top: 'a', front: 'b', right: 'c', iso: 'd' }
    const body = buildLogoPlacementBody({
      projectId: 'p1',
      message: 'logo gravado (posicionado no viewer)',
      logoPlacement,
      pendingMeshUrl: '/uploads/mesh.3mf',
      pendingPreviews: previews,
      imageUrl: '/uploads/logo.png',
    })
    expect(body.meshUrl).toBe('/uploads/mesh.3mf')
    expect(body.previewDataUrls).toEqual(previews)
    expect(body.imageUrl).toBe('/uploads/logo.png')
    expect(body.logoPlacement).toEqual(logoPlacement)
  })

  it('omits mesh/image when null so API can resolve from history', () => {
    const body = buildLogoPlacementBody({
      projectId: 'p1',
      message: 'logo',
      logoPlacement,
      pendingMeshUrl: null,
      pendingPreviews: null,
      imageUrl: null,
    })
    expect(body.meshUrl).toBeUndefined()
    expect(body.previewDataUrls).toBeUndefined()
    expect(body.imageUrl).toBeUndefined()
  })

  it('forwards freeform baseMeshUrl when no pending upload', () => {
    const body = buildLogoPlacementBody({
      projectId: 'p1',
      message: 'logo',
      logoPlacement,
      pendingMeshUrl: null,
      pendingPreviews: null,
      imageUrl: '/uploads/logo.png',
      baseMeshUrl: '/meshes/freeform.stl',
    })
    expect(body.meshUrl).toBe('/meshes/freeform.stl')
    expect(body.imageUrl).toBe('/uploads/logo.png')
  })
})

describe('suggestedLogoSizeMm', () => {
  it('returns fallback without positions', () => {
    expect(suggestedLogoSizeMm(null)).toBe(45)
  })

  it('sizes to ~80% of the face (two largest bbox axes)', () => {
    // 80×50×3 plate → face = min(80,50)=50 → 0.8*50 = 40
    const positions = new Float32Array([
      0, 0, 0, 80, 0, 0, 80, 50, 0,
      0, 0, 0, 80, 50, 0, 0, 50, 0,
      0, 0, 3, 80, 0, 3, 80, 50, 3,
    ])
    expect(suggestedLogoSizeMm(positions)).toBe(40)
  })
})
