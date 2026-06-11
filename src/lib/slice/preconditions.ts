export type Sliceable = { ok: true } | { ok: false; status: number; message: string }

/** Only ready/sliced iterations may be sliced — never a generating/failed one.
 *  Pure (no auth/db imports) so it's unit-testable in the node env without
 *  pulling the route's next-auth → next/server chain. */
export function assertSliceable(status: string): Sliceable {
  return status === 'ready' || status === 'sliced'
    ? { ok: true }
    : { ok: false, status: 409, message: `Cannot slice an iteration with status "${status}"` }
}
