import { describe, it, expect } from 'vitest'
import { fmtPrintTime, fmtFilament, fmtFilamentM } from '@/components/SliceButton'

describe('SliceButton metadata formatting', () => {
  it('renders a real 0 instead of em-dash', () => {
    expect(fmtPrintTime(0)).toBe('0 min')
    expect(fmtFilament(0)).toBe('0.0 g')
    expect(fmtFilamentM(0)).toBe('0.00 m')
  })
  it('renders em-dash only for null/undefined', () => {
    expect(fmtPrintTime(null)).toBe('—')
    expect(fmtFilament(null)).toBe('—')
    expect(fmtFilamentM(null)).toBe('—')
    expect(fmtFilamentM(undefined)).toBe('—')
  })
  it('formats normal values', () => {
    expect(fmtPrintTime(90)).toBe('90 min')
    expect(fmtFilament(9.73)).toBe('9.7 g')
    expect(fmtFilamentM(2.694)).toBe('2.69 m')
  })
})
