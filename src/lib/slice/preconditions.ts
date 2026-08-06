export type Sliceable = { ok: true } | { ok: false; status: number; message: string }

/** Only ready/sliced iterations may be sliced — never a generating/failed one.
 *  Pure (no auth/db imports) so it's unit-testable in the node env without
 *  pulling the route's next-auth → next/server chain. */
export function assertSliceable(status: string): Sliceable {
  return status === 'ready' || status === 'sliced'
    ? { ok: true }
    : { ok: false, status: 409, message: `Cannot slice an iteration with status "${status}"` }
}

/**
 * Mesh topology policy for slicing.
 *
 * Parametric pieces prefer watertight solids, but LSF maquetes are intentional
 * multi-body non-watertight skeletons — never block them on manifold status.
 * Pure helper so UI + slice route can share the same rule.
 */
export function allowsNonWatertightSlice(strategy: string | null | undefined): boolean {
  return strategy === 'lsf_maquette'
}
