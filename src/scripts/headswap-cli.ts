/**
 * CLI entry point for the head-swap pipeline.
 *
 * Usage:
 *   pnpm tsx src/scripts/headswap-cli.ts <octopus.3mf> <meshy.3mf> <output.3mf>
 *
 * Options (positional after output path):
 *   --head-cutoff <z>     Z above which Meshy triangles count as head (default 36)
 *   --width-factor <n>    Head width as a multiple of body width (default 1.2)
 *   --embed <mm>          Head embedding into body (default 1.0)
 *
 * Example:
 *   pnpm tsx src/scripts/headswap-cli.ts \
 *     "/Users/gustavoparis/Downloads/octopus1(2).3mf" \
 *     tests/fixtures/meshy-mascot.3mf \
 *     /Users/gustavoparis/Downloads/mascot-octocustom.3mf
 */
import { readFile, writeFile } from 'node:fs/promises'
import { headSwap } from '../lib/flexify/headswap'

function parseOptArg(name: string, args: string[]): number | undefined {
  const idx = args.indexOf(name)
  if (idx < 0 || idx === args.length - 1) return undefined
  const n = parseFloat(args[idx + 1])
  return Number.isFinite(n) ? n : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')))
  const [octopusPath, meshyPath, outPath] = positional
  if (!octopusPath || !meshyPath || !outPath) {
    console.error(
      'usage: tsx headswap-cli.ts <octopus.3mf> <meshy.3mf> <output.3mf>\n' +
      '         [--head-cutoff <z>] [--width-factor <n>] [--embed <mm>]'
    )
    process.exit(1)
  }

  const meshyHeadCutoffZ = parseOptArg('--head-cutoff', args)
  const headWidthFactor = parseOptArg('--width-factor', args)
  const embedDepthMm = parseOptArg('--embed', args)

  console.log(`Octopus base: ${octopusPath}`)
  console.log(`Meshy (head): ${meshyPath}`)
  console.log(`Output:       ${outPath}`)
  if (meshyHeadCutoffZ !== undefined) console.log(`  head-cutoff:   z=${meshyHeadCutoffZ}`)
  if (headWidthFactor !== undefined) console.log(`  width-factor:  ${headWidthFactor}×`)
  if (embedDepthMm !== undefined) console.log(`  embed:         ${embedDepthMm}mm`)
  console.log()

  console.time('headswap total')
  const octopusBytes = new Uint8Array(await readFile(octopusPath))
  const meshyBytes = new Uint8Array(await readFile(meshyPath))
  const { bytes, report } = await headSwap(octopusBytes, meshyBytes, {
    meshyHeadCutoffZ,
    headWidthFactor,
    embedDepthMm,
  })
  console.timeEnd('headswap total')

  await writeFile(outPath, bytes)

  console.log('\n=== Report ===')
  console.log(`Octopus components: ${report.octopusComponentCount}`)
  console.log(`Octopus body bbox:  ${report.octopusBodyBboxMm.map((s) => s.toFixed(1)).join(' × ')} mm`)
  console.log(`Head triangles:     ${report.headTriangleCount.toLocaleString()}`)
  console.log(`Head bbox (placed): ${report.headBboxMm.map((s) => s.toFixed(1)).join(' × ')} mm`)
  console.log(`Head scale:         ${report.headScale.toFixed(3)}×`)
  console.log(`Head translate:     [${report.headTranslateMm.map((s) => s.toFixed(1)).join(', ')}] mm`)
  console.log(`\nOutput: ${outPath}`)
  console.log(`Size:   ${(bytes.length / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
