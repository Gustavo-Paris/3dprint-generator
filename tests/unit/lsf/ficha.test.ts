import { describe, it, expect } from 'vitest'
import { buildLsfFichaMarkdown } from '@/lib/lsf/ficha'

describe('buildLsfFichaMarkdown', () => {
  it('includes scale, minT, fit bed and print tips', () => {
    const md = buildLsfFichaMarkdown({
      scale: 50,
      minTMm: 2.0,
      fitBed: true,
      ifcName: 'steel.ifc',
      meshUrl: '/meshes/abc.3mf',
      projectTitle: 'SteelPrime',
      meta: { walls: 12, took_s: 40 },
    })
    expect(md).toMatch(/1:50/)
    expect(md).toMatch(/2 mm/)
    expect(md).toMatch(/Fit leito H2D:\*\* sim/)
    expect(md).toMatch(/steel\.ifc/)
    expect(md).toMatch(/non-watertight/)
    expect(md).toMatch(/walls: 12/)
  })

  it('defaults scale/minT when missing', () => {
    const md = buildLsfFichaMarkdown({ scale: 0 })
    expect(md).toMatch(/1:70/)
    expect(md).toMatch(/1\.9 mm/)
  })
})
