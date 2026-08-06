// Real iteration "kind" written to iterations.strategy. Supersedes the legacy
// ['parametric','generative'] pair, which carried no information (every row was
// hardcoded 'generative'). 'parametric'/'generative' are kept for back-compat on
// existing rows; new writes use the design.kind below (+ 'flexified' for the
// articulate pipeline, which has no Design kind of its own).
export const iterationStrategies = [
  'parametric', 'generative',
  'hollow_cylinder', 'flat_plate', 'disc', 'bookmark', 'pin',
  'custom_keychain', 'mug', 'imported', 'composite', 'freeform', 'flexified',
  'parametric_code', 'box',
  /** IFC → LSF print maquete (SteelPrime golden recipe). */
  'lsf_maquette',
] as const
export type IterationStrategy = (typeof iterationStrategies)[number]

export function designKindToStrategy(kind: string): IterationStrategy {
  return (iterationStrategies as readonly string[]).includes(kind)
    ? (kind as IterationStrategy)
    : 'generative'
}
