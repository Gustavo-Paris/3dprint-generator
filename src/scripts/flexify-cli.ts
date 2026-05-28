/**
 * CLI entry point for the flexify pipeline.
 *
 * Usage:
 *   pnpm tsx src/scripts/flexify-cli.ts \
 *     <meshy.3mf> <rocktopus.3mf> <output.3mf>
 *
 * Example:
 *   pnpm tsx src/scripts/flexify-cli.ts \
 *     tests/fixtures/meshy-mascot.3mf \
 *     tests/fixtures/rocktopus-reference.3mf \
 *     public/uploads/mascot-flexi.3mf
 */
import { readFile, writeFile } from 'node:fs/promises'
import { flexify } from '../lib/flexify'

async function main() {
  const [meshyPath, rocktopusPath, outPath] = process.argv.slice(2)
  if (!meshyPath || !rocktopusPath || !outPath) {
    console.error('usage: tsx flexify-cli.ts <meshy.3mf> <rocktopus.3mf> <output.3mf>')
    process.exit(1)
  }

  console.log(`Meshy:      ${meshyPath}`)
  console.log(`Rocktopus:  ${rocktopusPath}`)
  console.log(`Output:     ${outPath}\n`)

  console.time('flexify total')
  const meshyBytes = new Uint8Array(await readFile(meshyPath))
  const rocktopusBytes = new Uint8Array(await readFile(rocktopusPath))
  const { bytes, report } = await flexify(meshyBytes, rocktopusBytes)
  console.timeEnd('flexify total')

  await writeFile(outPath, bytes)

  console.log('\n=== Report ===')
  console.log(`Components in output: ${report.componentCount}`)
  console.log(`Joints:               ${report.jointCount}`)
  console.log(`Total triangles:      ${report.totalTriangles.toLocaleString()}`)
  console.log(`Meshy input:          ${report.meshyTriangleCount.toLocaleString()} tris`)
  console.log(`Rocktopus input:      ${report.rocktopusTriangleCount.toLocaleString()} tris`)
  console.log(`Rocktopus scale:      ${report.rocktopusScale.toFixed(3)}×`)
  console.log(`Fallback components:  ${report.fallbackComponents.length} ${report.fallbackComponents.length > 0 ? `(IDs: ${report.fallbackComponents.join(', ')})` : ''}`)
  console.log(`\nOutput written: ${outPath}`)
  console.log(`Size: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
