/**
 * Sanity-clamp a Design coming out of the LLM. The LLM can hallucinate
 * dimensions that are unprintable (wall = 0.5mm) or absurd (height = 5m).
 * We pin every numeric field into a printable / sensible range and collect
 * a list of warnings so the user knows what was adjusted.
 */
import type { Design } from './schema'

const RANGE = {
  hollow_cylinder: {
    insideDiameterMm: [20, 250] as const,
    heightMm: [20, 250] as const,
    wallMm: [1.5, 10] as const,
    baseMm: [1.5, 10] as const,
    handle: {
      heightMm: [20, 200] as const,
      stickOutMm: [10, 80] as const,
      thicknessMm: [5, 25] as const,
      fingerHoleDiameterMm: [10, 60] as const,
    },
  },
  flat_plate: {
    widthMm: [20, 300] as const,
    heightMm: [20, 300] as const,
    thicknessMm: [2, 20] as const,
    cornerRadiusMm: [0, 50] as const,
    hangingHoleDiameterMm: [2, 15] as const,
    standAngleDeg: [0, 60] as const,
  },
  disc: {
    diameterMm: [20, 250] as const,
    thicknessMm: [2, 20] as const,
    hangingRingOuterMm: [5, 30] as const,
    hangingRingInnerMm: [1, 20] as const,
    hangingHoleDiameterMm: [2, 15] as const,
  },
  bookmark: {
    widthMm: [15, 60] as const,
    heightMm: [60, 200] as const,
    thicknessMm: [1.0, 3.0] as const,
    hangingHoleDiameterMm: [2, 10] as const,
  },
  pin: {
    diameterMm: [15, 50] as const,
    thicknessMm: [1.5, 4.0] as const,
    pinDiameterMm: [3.0, 6.0] as const,
    pinHeightMm: [5, 15] as const,
  },
  custom_keychain: {
    thicknessMm: [2, 10] as const,
    paddingMm: [2, 10] as const,
  },
  mug: {
    insideDiameterMm: [50, 120] as const,
    heightMm: [50, 150] as const,
    wallMm: [2, 10] as const,
    baseMm: [2, 12] as const,
    handleHeightMm: [30, 130] as const,
    handleStickOutMm: [15, 60] as const,
    handleThicknessMm: [5, 20] as const,
  },
  logo: {
    depthMm: [0.5, 10] as const,
  },
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

interface Adjustment {
  field: string
  from: number
  to: number
}

export interface SanitizeResult {
  design: Design
  adjustments: Adjustment[]
}

export function sanitizeDesign(input: Design): SanitizeResult {
  const adjustments: Adjustment[] = []

  function adj(field: string, value: number, min: number, max: number): number {
    const clamped = clamp(value, min, max)
    if (clamped !== value) {
      adjustments.push({ field, from: value, to: clamped })
    }
    return clamped
  }

  if (input.kind === 'hollow_cylinder') {
    const R = RANGE.hollow_cylinder
    const out: Design = {
      ...input,
      insideDiameterMm: adj('insideDiameterMm', input.insideDiameterMm, ...R.insideDiameterMm),
      heightMm: adj('heightMm', input.heightMm, ...R.heightMm),
      wallMm: adj('wallMm', input.wallMm, ...R.wallMm),
      baseMm: adj('baseMm', input.baseMm, ...R.baseMm),
    }
    if (input.handle) {
      out.handle = {
        heightMm: adj('handle.heightMm', input.handle.heightMm, ...R.handle.heightMm),
        stickOutMm: adj('handle.stickOutMm', input.handle.stickOutMm, ...R.handle.stickOutMm),
        thicknessMm: adj('handle.thicknessMm', input.handle.thicknessMm, ...R.handle.thicknessMm),
        fingerHoleDiameterMm: adj(
          'handle.fingerHoleDiameterMm',
          input.handle.fingerHoleDiameterMm,
          ...R.handle.fingerHoleDiameterMm,
        ),
      }
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'flat_plate') {
    const R = RANGE.flat_plate
    const widthMm = adj('widthMm', input.widthMm, ...R.widthMm)
    const heightMm = adj('heightMm', input.heightMm, ...R.heightMm)
    // Corner radius can't exceed half the smaller dim.
    const cornerMaxByDim = Math.min(widthMm, heightMm) / 2
    const cornerRadiusMm = adj(
      'cornerRadiusMm',
      input.cornerRadiusMm,
      R.cornerRadiusMm[0],
      Math.min(R.cornerRadiusMm[1], cornerMaxByDim),
    )
    const out: Design = {
      ...input,
      widthMm,
      heightMm,
      thicknessMm: adj('thicknessMm', input.thicknessMm, ...R.thicknessMm),
      cornerRadiusMm,
    }
    if (input.hangingHole) {
      out.hangingHole = {
        diameterMm: adj(
          'hangingHole.diameterMm',
          input.hangingHole.diameterMm,
          ...R.hangingHoleDiameterMm,
        ),
        position: input.hangingHole.position,
      }
    }
    if (input.standAngleDeg !== undefined) {
      out.standAngleDeg = adj('standAngleDeg', input.standAngleDeg, ...R.standAngleDeg)
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'disc') {
    const R = RANGE.disc
    const out: Design = {
      ...input,
      diameterMm: adj('diameterMm', input.diameterMm, ...R.diameterMm),
      thicknessMm: adj('thicknessMm', input.thicknessMm, ...R.thicknessMm),
    }
    if (input.hangingRing) {
      const outerDiameterMm = adj(
        'hangingRing.outerDiameterMm',
        input.hangingRing.outerDiameterMm,
        ...R.hangingRingOuterMm,
      )
      // Inner < outer.
      const innerDiameterMm = adj(
        'hangingRing.innerDiameterMm',
        input.hangingRing.innerDiameterMm,
        R.hangingRingInnerMm[0],
        Math.min(R.hangingRingInnerMm[1], outerDiameterMm - 1),
      )
      out.hangingRing = { outerDiameterMm, innerDiameterMm }
    }
    if (input.hangingHole) {
      out.hangingHole = {
        diameterMm: adj(
          'hangingHole.diameterMm',
          input.hangingHole.diameterMm,
          ...R.hangingHoleDiameterMm,
        ),
        position: input.hangingHole.position,
      }
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'bookmark') {
    const R = RANGE.bookmark
    const out: Design = {
      ...input,
      widthMm: adj('widthMm', input.widthMm, ...R.widthMm),
      heightMm: adj('heightMm', input.heightMm, ...R.heightMm),
      thicknessMm: adj('thicknessMm', input.thicknessMm, ...R.thicknessMm),
    }
    if (input.hangingHole) {
      out.hangingHole = {
        diameterMm: adj(
          'hangingHole.diameterMm',
          input.hangingHole.diameterMm,
          ...R.hangingHoleDiameterMm,
        ),
        position: input.hangingHole.position,
      }
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'pin') {
    const R = RANGE.pin
    const out: Design = {
      ...input,
      diameterMm: adj('diameterMm', input.diameterMm, ...R.diameterMm),
      thicknessMm: adj('thicknessMm', input.thicknessMm, ...R.thicknessMm),
      pinDiameterMm: adj('pinDiameterMm', input.pinDiameterMm, ...R.pinDiameterMm),
      pinHeightMm: adj('pinHeightMm', input.pinHeightMm, ...R.pinHeightMm),
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'custom_keychain') {
    const R = RANGE.custom_keychain
    const out: Design = {
      ...input,
      thicknessMm: adj('thicknessMm', input.thicknessMm, ...R.thicknessMm),
      paddingMm: adj('paddingMm', input.paddingMm, ...R.paddingMm),
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'mug') {
    const R = RANGE.mug
    const out: Design = {
      ...input,
      insideDiameterMm: adj('insideDiameterMm', input.insideDiameterMm, ...R.insideDiameterMm),
      heightMm: adj('heightMm', input.heightMm, ...R.heightMm),
      wallMm: adj('wallMm', input.wallMm, ...R.wallMm),
      baseMm: adj('baseMm', input.baseMm, ...R.baseMm),
      handleHeightMm: adj('handleHeightMm', input.handleHeightMm, ...R.handleHeightMm),
      handleStickOutMm: adj('handleStickOutMm', input.handleStickOutMm, ...R.handleStickOutMm),
      handleThicknessMm: adj('handleThicknessMm', input.handleThicknessMm, ...R.handleThicknessMm),
    }
    if (input.logo) out.logo = sanitizeLogo(input.logo, adjustments)
    return { design: out, adjustments }
  }

  if (input.kind === 'imported') {
    // Edits are validated by Zod at parse time; numeric clamping
    // doesn't apply (geometry comes from the imported mesh, not LLM-named dims).
    return { design: input, adjustments: [] }
  }

  // Exhaustiveness
  return { design: input, adjustments }
}

function sanitizeLogo<T extends { depthMm?: number }>(logo: T, adjustments: Adjustment[]): T {
  if (logo.depthMm === undefined) return logo
  const clamped = clamp(logo.depthMm, ...RANGE.logo.depthMm)
  if (clamped !== logo.depthMm) {
    adjustments.push({ field: 'logo.depthMm', from: logo.depthMm, to: clamped })
  }
  return { ...logo, depthMm: clamped }
}
