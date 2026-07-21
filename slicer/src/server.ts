import express from 'express'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse3mfSliceMeta } from './slice-meta'

const app = express()
// Real imported meshes (500k–2M triangles) base64 to tens of MB. 20mb rejected
// them with a 413 before OrcaSlicer ever saw the model.
app.use(express.json({ limit: '100mb' }))

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
  const profile = readFileSync(`${PROFILES_DIR}/machine_x1c_0.4.json`, 'utf8')
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
  const { stl_base64, quality } = req.body ?? {}
  if (typeof stl_base64 !== 'string' || stl_base64.length === 0) {
    return res.status(400).json({ error: 'stl_base64 required' })
  }

  // Optional print quality. Anything other than the exact literal 'fine' falls
  // back to 'standard' — never an error for an invalid/absent quality.
  const processProfile = quality === 'fine' ? 'process_x1c_0.16.json' : 'process_x1c_0.20.json'

  if (!existsSync(`${PROFILES_DIR}/machine_x1c_0.4.json`)) {
    return res.status(500).json({ error: 'Profiles not bundled yet (TASK-024)' })
  }

  const work = mkdtempSync(join(tmpdir(), 'slice-'))
  try {
    // Detect the model format by magic bytes: a 3MF is a zip ("PK"), anything
    // else is treated as STL. OrcaSlicer infers the loader from the extension,
    // so a 3MF written as `in.stl` fails with "Loading of a model file failed".
    const modelBytes = Buffer.from(stl_base64, 'base64')
    const is3mf = modelBytes[0] === 0x50 && modelBytes[1] === 0x4b
    const inPath = join(work, is3mf ? 'in.3mf' : 'in.stl')
    const outPath = join(work, 'out.3mf')
    writeFileSync(inPath, modelBytes)

    // OrcaSlicer rejects a 3MF input when --load-filament-ids is set
    // ("can not load 3mf when set loaded_filament_ids or clone_objects"), so
    // omit it for 3MF — the loaded filament is used by default (single-material
    // slice; multi-colour stays the Download-3MF path).
    const result = spawnSync(ORCA_BIN, [
      '--debug', '5',
      '--no-check',
      '--slice', '0',
      '--load-settings', `${PROFILES_DIR}/machine_x1c_0.4.json;${PROFILES_DIR}/${processProfile}`,
      '--load-filaments', `${PROFILES_DIR}/filament_generic_pla.json`,
      ...(is3mf ? [] : ['--load-filament-ids', '1']),
      '--export-3mf', outPath,
      inPath,
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
    const meta = parse3mfSliceMeta(out)

    res.json({
      bytes_base64: out.toString('base64'),
      meta: {
        print_time_min: meta.print_time_min,
        filament_g: meta.filament_g,
        filament_m: meta.filament_m,
        stdout_tail: result.stdout.slice(-1000),
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
