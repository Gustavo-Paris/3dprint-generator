import { describe, it, expect } from 'vitest'
import { exportOptionLabels } from '@/components/ExportMenu'

describe('exportOptionLabels', () => {
  it('names STL raw when mesh is not a 3MF zip', () => {
    const l = exportOptionLabels({ is3mf: false, canExportMulticolor: false })
    expect(l.raw).toMatch(/STL/)
    expect(l.multicolor).toMatch(/pinte|salve/i)
    expect(l.slicedHint).toMatch(/Fatiar/)
  })

  it('names 3MF raw + multi-cor when available', () => {
    const l = exportOptionLabels({ is3mf: true, canExportMulticolor: true })
    expect(l.raw).toMatch(/3MF cru/)
    expect(l.multicolor).toMatch(/multi-cor com perfil/)
  })
})
