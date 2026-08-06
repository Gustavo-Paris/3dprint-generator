import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  meshStorageDir,
  meshWritePath,
  uploadWritePath,
} from '@/lib/storage/local-asset'

describe('local-asset paths', () => {
  it('keeps mesh writes under private store by default', () => {
    expect(meshStorageDir()).toContain('.data')
    expect(meshWritePath('abc.stl')).toBe(join(meshStorageDir(), 'abc.stl'))
  })

  it('rejects path traversal in names', () => {
    expect(() => meshWritePath('../etc/passwd')).toThrow(/invalid/)
    expect(() => uploadWritePath('a/b.png')).toThrow(/invalid/)
  })
})
