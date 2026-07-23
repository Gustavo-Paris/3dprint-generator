import { describe, it, expect, vi, afterEach } from 'vitest'
import { unzipSync } from 'fflate'
import type { MeshBodyData } from '@/lib/3mf/serialize-3mf'
import { parse3mf } from '@/lib/3mf/parse-3mf'
import { handleSerializeMessage, type SerializeWorkerIn } from '@/lib/3mf/serialize-worker'
import { runSerialize3mfInWorker } from '@/lib/3mf/run-serialize-worker'

const bodies = (): MeshBodyData[] => [
  {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]),
    extruder: 'A',
    label: 'Body',
  },
  {
    positions: new Float32Array([0, 0, 5, 5, 0, 5, 5, 5, 5]),
    extruder: 'B',
    label: 'Logo',
  },
]

describe('handleSerializeMessage (worker message handler)', () => {
  it('serializes bodies into a parseable multi-colour 3MF', () => {
    const out = handleSerializeMessage({ bodies: bodies() })
    if (!out.ok) throw new Error(out.error)
    const parsed = parse3mf(out.bytes)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].extruder).toBe('A')
    expect(parsed[1].extruder).toBe('B')
  })

  it('forwards opts (colors + projectSettings) to serialize3mf', () => {
    const out = handleSerializeMessage({
      bodies: bodies(),
      opts: {
        colors: { aHex: '#112233', bHex: '#445566' },
        projectSettings: { printer_model: ['X1C'] },
      },
    })
    if (!out.ok) throw new Error(out.error)
    const zip = unzipSync(out.bytes)
    const model = new TextDecoder().decode(zip['3D/3dmodel.model'])
    expect(model).toContain('#112233FF')
    expect(model).toContain('#445566FF')
    const settings = new TextDecoder().decode(zip['Metadata/project_settings.config'])
    expect(JSON.parse(settings)).toEqual({ printer_model: ['X1C'] })
  })

  it('returns ok:false instead of throwing on invalid input', () => {
    const out = handleSerializeMessage({
      bodies: [{ positions: undefined } as unknown as MeshBodyData],
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.length).toBeGreaterThan(0)
  })
})

/**
 * Fake Worker reproducing the turbopack-dev race that hung the export button:
 * the worker module evaluates ASYNCHRONOUSLY behind a wrapper script, so any
 * job posted before evaluation completes is silently dropped. After
 * evaluation it behaves like the real serialize worker (posts `ready`, then
 * answers jobs via handleSerializeMessage).
 */
class RacyFakeWorker extends EventTarget {
  static instances: RacyFakeWorker[] = []
  evaluated = false
  dropped: unknown[] = []
  terminated = false
  constructor(_url: unknown, _opts?: unknown) {
    super()
    RacyFakeWorker.instances.push(this)
    setTimeout(() => {
      this.evaluated = true
      this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }))
    }, 5)
  }
  postMessage(data: unknown, _transfers?: unknown[]) {
    if (!this.evaluated) {
      this.dropped.push(data) // the turbopack race: message lost, no error
      return
    }
    setTimeout(() => {
      const out = handleSerializeMessage(data as SerializeWorkerIn)
      this.dispatchEvent(new MessageEvent('message', { data: out }))
    }, 0)
  }
  terminate() {
    this.terminated = true
  }
}

/** Never evaluates — ready never arrives (worst-case silent wrapper failure). */
class DeadFakeWorker extends EventTarget {
  posted: unknown[] = []
  postMessage(data: unknown) {
    this.posted.push(data)
  }
  terminate() {}
}

/**
 * Shared worker that answers jobs OUT OF ORDER and echoes reqId like the real
 * one — reproduces the cross-talk bug: the reply fans to every in-flight
 * listener, so without reqId correlation the first reply would settle BOTH
 * pending promises (call B would download call A's bytes).
 */
class OutOfOrderFakeWorker extends EventTarget {
  static instances: OutOfOrderFakeWorker[] = []
  private queue: SerializeWorkerIn[] = []
  constructor() {
    super()
    OutOfOrderFakeWorker.instances.push(this)
    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } })), 1)
  }
  postMessage(data: SerializeWorkerIn) {
    this.queue.push(data)
    // Answer only once both jobs are queued, newest-first (reversed order).
    if (this.queue.length === 2) {
      for (const job of [...this.queue].reverse()) {
        const out = { ...handleSerializeMessage(job), reqId: job.reqId }
        this.dispatchEvent(new MessageEvent('message', { data: out }))
      }
    }
  }
  terminate() {}
}

describe('runSerialize3mfInWorker — ready handshake (async worker startup)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not lose the job to a worker that attaches onmessage late', async () => {
    RacyFakeWorker.instances = []
    vi.stubGlobal('Worker', RacyFakeWorker)
    vi.resetModules()
    const { runSerialize3mfInWorker: run } = await import('@/lib/3mf/run-serialize-worker')

    const bytes = await run(bodies(), { colors: { aHex: '#123456', bHex: '#654321' } })
    expect(parse3mf(bytes)).toHaveLength(2)

    // The wrapper waited for the handshake — nothing was posted pre-evaluation.
    expect(RacyFakeWorker.instances).toHaveLength(1)
    expect(RacyFakeWorker.instances[0].dropped).toHaveLength(0)
  })

  it('keeps concurrent jobs correlated — reply fan-out never crosses promises', async () => {
    OutOfOrderFakeWorker.instances = []
    vi.stubGlobal('Worker', OutOfOrderFakeWorker)
    vi.resetModules()
    const { runSerialize3mfInWorker: run } = await import('@/lib/3mf/run-serialize-worker')

    // Two overlapping exports on the shared worker, distinguishable by colour,
    // answered newest-first. Each must resolve to ITS OWN bytes.
    const [bytesA, bytesB] = await Promise.all([
      run(bodies(), { colors: { aHex: '#aa0000', bHex: '#00aa00' } }),
      run(bodies(), { colors: { aHex: '#0000bb', bHex: '#bb00bb' } }),
    ])
    const modelA = new TextDecoder().decode(unzipSync(bytesA)['3D/3dmodel.model'])
    const modelB = new TextDecoder().decode(unzipSync(bytesB)['3D/3dmodel.model'])
    expect(modelA).toContain('#aa0000FF')
    expect(modelA).not.toContain('#0000bbFF')
    expect(modelB).toContain('#0000bbFF')
    expect(modelB).not.toContain('#aa0000FF')
    expect(OutOfOrderFakeWorker.instances).toHaveLength(1) // shared singleton
  })

  it('falls back to synchronous serialization when the worker never becomes ready', async () => {
    vi.stubGlobal('Worker', DeadFakeWorker)
    vi.resetModules()
    vi.useFakeTimers()
    const { runSerialize3mfInWorker: run } = await import('@/lib/3mf/run-serialize-worker')

    const p = run(bodies(), { colors: { aHex: '#0a0b0c', bHex: '#d0e0f0' } })
    await vi.advanceTimersByTimeAsync(11_000)
    const bytes = await p
    expect(parse3mf(bytes)).toHaveLength(2)
    const model = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model'])
    expect(model).toContain('#0a0b0cFF')
  })
})

describe('runSerialize3mfInWorker — sync fallback (no Worker in node)', () => {
  it('resolves with the same 3MF the synchronous serializer produces', async () => {
    expect(typeof Worker).toBe('undefined') // precondition: fallback path
    const bytes = await runSerialize3mfInWorker(bodies(), {
      colors: { aHex: '#0a0b0c', bHex: '#d0e0f0' },
    })
    const parsed = parse3mf(bytes)
    expect(parsed).toHaveLength(2)
    const model = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model'])
    // Panel hex is written verbatim + opaque alpha (WYSIWYG export).
    expect(model).toContain('#0a0b0cFF')
    expect(model).toContain('#d0e0f0FF')
  })

  it('rejects (never throws synchronously) on invalid bodies', async () => {
    await expect(
      runSerialize3mfInWorker([{ positions: undefined } as unknown as MeshBodyData]),
    ).rejects.toBeInstanceOf(Error)
  })
})
