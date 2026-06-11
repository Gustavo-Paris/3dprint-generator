import { randomUUID } from 'node:crypto'

type Level = 'info' | 'warn' | 'error'

function serializeErr(err: unknown) {
  if (err instanceof Error) return { message: err.message, stack: err.stack }
  return { message: String(err) }
}

export interface RequestLogger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, err?: unknown, fields?: Record<string, unknown>): void
}

/** One logger per request. `reqId` correlates every line of a single handler. */
export function createRequestLogger(route: string, reqId = randomUUID()): RequestLogger {
  function emit(level: Level, msg: string, extra: Record<string, unknown>) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, route, reqId, msg, ...extra })
    if (level === 'error') console.error(line)
    else console.log(line)
  }
  return {
    info: (msg, fields = {}) => emit('info', msg, fields),
    warn: (msg, fields = {}) => emit('warn', msg, fields),
    error: (msg, err, fields = {}) =>
      emit('error', msg, { ...(err !== undefined ? { err: serializeErr(err) } : {}), ...fields }),
  }
}
