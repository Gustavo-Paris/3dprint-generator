declare module 'potrace' {
  export interface TraceOptions {
    turdSize?: number
    alphaMax?: number
    optCurve?: boolean
    optTolerance?: number
    threshold?: number | typeof Potrace.THRESHOLD_AUTO
    blackOnWhite?: boolean
    color?: string
    background?: string
  }
  export const Potrace: {
    THRESHOLD_AUTO: -1
    COLOR_AUTO: 'auto'
    COLOR_TRANSPARENT: 'transparent'
    TURNPOLICY_BLACK: 'black'
    TURNPOLICY_WHITE: 'white'
    TURNPOLICY_LEFT: 'left'
    TURNPOLICY_RIGHT: 'right'
    TURNPOLICY_MINORITY: 'minority'
    TURNPOLICY_MAJORITY: 'majority'
  }
  export function trace(
    input: Buffer | string,
    options: TraceOptions,
    callback: (err: Error | null, svg: string) => void,
  ): void
  export function trace(
    input: Buffer | string,
    callback: (err: Error | null, svg: string) => void,
  ): void
}
