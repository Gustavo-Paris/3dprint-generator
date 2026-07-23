/**
 * Unit tests: preview-bundle helpers — stub detection and validation of a
 * `_previews` jsonb value read back from the DB (the generate route's targeted
 * cached-previews re-fetch).
 */
import { describe, it, expect } from 'vitest'
import {
  STUB_PREVIEW,
  STUB_PREVIEW_BUNDLE,
  isStubPreviewBundle,
  readPreviewBundle,
} from '@/lib/design/preview-bundle'

const real = {
  top: 'data:image/png;base64,VE9Q',
  front: 'data:image/png;base64,RlJPTlQ=',
  right: 'data:image/png;base64,UklHSFQ=',
  iso: 'data:image/png;base64,SVNP',
}

describe('isStubPreviewBundle', () => {
  it('true for the stub bundle itself', () => {
    expect(isStubPreviewBundle(STUB_PREVIEW_BUNDLE)).toBe(true)
  })

  it('false when any view is a real capture', () => {
    expect(isStubPreviewBundle({ ...STUB_PREVIEW_BUNDLE, iso: real.iso })).toBe(false)
    expect(isStubPreviewBundle(real)).toBe(false)
  })
})

describe('readPreviewBundle', () => {
  it('accepts a valid 4-view bundle of image data URLs', () => {
    expect(readPreviewBundle(real)).toEqual(real)
  })

  it('accepts the stub bundle shape (filtering stubs is the SQL query’s job)', () => {
    expect(readPreviewBundle(STUB_PREVIEW_BUNDLE)).toEqual(STUB_PREVIEW_BUNDLE)
    expect(STUB_PREVIEW_BUNDLE.iso).toBe(STUB_PREVIEW)
  })

  it('rejects non-objects, arrays, missing views, and non-image strings', () => {
    expect(readPreviewBundle(null)).toBeNull()
    expect(readPreviewBundle(undefined)).toBeNull()
    expect(readPreviewBundle('data:image/png;base64,x')).toBeNull()
    expect(readPreviewBundle([real.top, real.front, real.right, real.iso])).toBeNull()
    expect(readPreviewBundle({ ...real, iso: undefined })).toBeNull()
    expect(readPreviewBundle({ ...real, front: 'https://evil.example/x.png' })).toBeNull()
    expect(readPreviewBundle({ ...real, top: 42 })).toBeNull()
  })
})
