/**
 * Spawn the IFC → LSF maquete Python worker (golden recipe).
 *
 * Worker: cad-workshop/parts/lsf-maquete/lsf_maquette.py
 * Override paths with LSF_PYTHON / LSF_WORKER env vars.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

export type LsfWorkerInput = {
  /** Absolute path to a local IFC file, OR raw IFC bytes. */
  ifcPath?: string
  ifcBytes?: Uint8Array
  scale?: number
  minTMm?: number
  fitBed?: boolean
  name?: string
}

export type LsfWorkerResult = {
  stl: Buffer
  /** Optional 3mf when worker produced one. */
  threeMf: Buffer | null
  meta: Record<string, unknown>
  outDir: string
}

function resolvePython(): string {
  return (
    process.env.LSF_PYTHON ||
    join(homedir(), 'www/text-to-cad/.venv/bin/python')
  )
}

function resolveWorker(): string {
  return (
    process.env.LSF_WORKER ||
    join(homedir(), 'www/cad-workshop/parts/lsf-maquete/lsf_maquette.py')
  )
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const t = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`lsf_maquette timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      clearTimeout(t)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function runLsfMaquette(
  input: LsfWorkerInput,
): Promise<LsfWorkerResult> {
  const python = resolvePython()
  const worker = resolveWorker()
  const outDir = await mkdtemp(join(tmpdir(), 'lsf-maquete-'))
  const name = input.name ?? 'LSF_maquete'

  let ifcPath = input.ifcPath
  if (!ifcPath) {
    if (!input.ifcBytes) {
      throw new Error('runLsfMaquette: ifcPath or ifcBytes required')
    }
    ifcPath = join(outDir, 'input.ifc')
    await writeFile(ifcPath, Buffer.from(input.ifcBytes))
  }

  const args = [
    worker,
    ifcPath,
    '-o',
    outDir,
    '--name',
    name,
    '--scale',
    String(input.scale ?? 70),
    '--min-t',
    String(input.minTMm ?? 1.9),
  ]
  if (input.fitBed === false) args.push('--no-fit-bed')

  const { code, stdout, stderr } = await run(python, args, 10 * 60 * 1000)
  if (code !== 0) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(
      `lsf_maquette failed (exit ${code}): ${stderr || stdout || 'no output'}`.slice(
        0,
        2000,
      ),
    )
  }

  const stlPath = join(outDir, `${name}.stl`)
  const mfPath = join(outDir, `${name}.3mf`)
  const jsonPath = join(outDir, `${name}.json`)

  const stl = await readFile(stlPath)
  let threeMf: Buffer | null = null
  try {
    threeMf = await readFile(mfPath)
  } catch {
    threeMf = null
  }
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(await readFile(jsonPath, 'utf8')) as Record<string, unknown>
  } catch {
    meta = { stdout: stdout.slice(-500) }
  }

  // Keep outDir for debugging only when LSF_KEEP_OUT=1
  if (process.env.LSF_KEEP_OUT !== '1') {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  }

  return { stl, threeMf, meta, outDir }
}

/** Ensure worker env looks available (best-effort for health checks). */
export async function lsfWorkerAvailable(): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  const { constants } = await import('node:fs')
  try {
    await access(resolvePython(), constants.X_OK)
    await access(resolveWorker(), constants.R_OK)
    return true
  } catch {
    return false
  }
}
