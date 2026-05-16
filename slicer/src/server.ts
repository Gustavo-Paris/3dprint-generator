import express from 'express'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const app = express()
app.use(express.json({ limit: '20mb' }))

const ORCA_BIN = process.env.ORCA_BIN ?? '/opt/orca/orca-extracted/AppRun'
const PROFILES_DIR = '/app/profiles'

app.get('/health', (_req, res) => {
  res.json({ ok: true, orca: ORCA_BIN, profiles_dir: PROFILES_DIR })
})

app.get('/diag', (_req, res) => {
  const ldd = spawnSync('ldd', [`${ORCA_BIN.replace('/AppRun', '/bin/orca-slicer')}`], { encoding: 'utf8' })
  const help = spawnSync(ORCA_BIN, ['--help'], { encoding: 'utf8' })
  const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' })
  const ls = spawnSync('ls', ['-la', '/opt/orca/orca-extracted/bin/'], { encoding: 'utf8' })
  const profile = readFileSync(`${PROFILES_DIR}/machine_h2d_pla.json`, 'utf8')
  const profileStartLines = profile.split('\n').slice(0, 25).join('\n')
  res.json({
    ldd: { code: ldd.status, stdout: ldd.stdout, stderr: ldd.stderr },
    orca_help: { code: help.status, stdout: help.stdout?.slice(0, 2000), stderr: help.stderr?.slice(0, 2000) },
    xvfb_run: xvfb.stdout?.trim(),
    bin_listing: ls.stdout,
    profile_first_25_lines: profileStartLines,
    profile_byte_size: profile.length,
  })
})

app.post('/slice', async (req, res) => {
  const { stl_base64 } = req.body ?? {}
  if (typeof stl_base64 !== 'string' || stl_base64.length === 0) {
    return res.status(400).json({ error: 'stl_base64 required' })
  }

  if (!existsSync(`${PROFILES_DIR}/machine_h2d_pla.json`)) {
    return res.status(500).json({ error: 'Profiles not bundled yet (TASK-024)' })
  }

  const work = mkdtempSync(join(tmpdir(), 'slice-'))
  try {
    const stlPath = join(work, 'in.stl')
    const outPath = join(work, 'out.3mf')
    writeFileSync(stlPath, Buffer.from(stl_base64, 'base64'))

    const result = spawnSync(ORCA_BIN, [
      '--debug', '5',
      '--no-check',
      '--slice', '0',
      '--load-settings', `${PROFILES_DIR}/machine_h2d_pla.json;${PROFILES_DIR}/process_h2d_pla_0.2mm.json`,
      '--load-filaments', `${PROFILES_DIR}/filament_generic_pla.json`,
      '--load-filament-ids', '1',
      '--export-3mf', outPath,
      stlPath,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        QT_QPA_PLATFORM: 'offscreen',
        LIBGL_ALWAYS_SOFTWARE: '1',
        MESA_GL_VERSION_OVERRIDE: '3.3',
        DISPLAY: '',
      },
    })

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'OrcaSlicer failed',
        status: result.status,
        signal: result.signal,
        stderr_tail: result.stderr?.slice(-8000) ?? '',
        stdout_tail: result.stdout?.slice(-8000) ?? '',
      })
    }

    const out = readFileSync(outPath)
    const stdout = result.stdout
    const timeMatch = stdout.match(/(?:print|estimated[_ ]printing)[\s_]*time[^:]*:?[\s_=]+([0-9.]+)/i)
    const weightMatch = stdout.match(/filament[\s_]*(?:used[\s_]*\(g\)|weight)[\s_]*:?[\s_=]+([0-9.]+)/i)

    res.json({
      bytes_base64: out.toString('base64'),
      meta: {
        print_time_min: timeMatch ? Number(timeMatch[1]) : null,
        filament_g: weightMatch ? Number(weightMatch[1]) : null,
        stdout_tail: stdout.slice(-1000),
      },
    })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  console.log(`Slicer service listening on :${port}`)
})
