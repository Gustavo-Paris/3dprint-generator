import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRequestLogger } from '@/lib/log'

afterEach(() => vi.restoreAllMocks())

describe('createRequestLogger', () => {
  it('emits a structured JSON line tagged with route + a request id', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createRequestLogger('generate')
    log.info('quick modifier matched', { message: 'logo maior' })
    expect(spy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(spy.mock.calls[0][0] as string)
    expect(line.route).toBe('generate')
    expect(line.level).toBe('info')
    expect(line.msg).toBe('quick modifier matched')
    expect(typeof line.reqId).toBe('string')
    expect(line.message).toBe('logo maior')
  })

  it('error() serialises an Error to message + stack, routes to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createRequestLogger('flexify')
    log.error('flexify failed', new Error('boom'))
    const line = JSON.parse(spy.mock.calls[0][0] as string)
    expect(line.level).toBe('error')
    expect(line.err.message).toBe('boom')
    expect(typeof line.err.stack).toBe('string')
  })

  it('reuses the same reqId across calls from one logger', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createRequestLogger('slice')
    log.info('a'); log.info('b')
    const a = JSON.parse(spy.mock.calls[0][0] as string)
    const b = JSON.parse(spy.mock.calls[1][0] as string)
    expect(a.reqId).toBe(b.reqId)
  })
})
