import fs from 'fs'
import path from 'path'
import { parseSvgPath, pointInPolygon, signedArea, Pt } from '../lib/logo-extrude/parse-svg-path'

async function main() {
  const svgPath = path.join(process.cwd(), 'public/debug-traced.svg')
  const svg = fs.readFileSync(svgPath, 'utf-8')
  
  const dMatch = svg.match(/\sd="([^"]+)"/)
  if (!dMatch) throw new Error('No path data')

  const subpathsRaw = parseSvgPath(dMatch[1])
  console.log("Total subpaths parsed:", subpathsRaw.length)

  const subpaths: Pt[][] = subpathsRaw.map((sp) => sp.map(([x, y]) => [x, -y] as Pt))

  type SubpathInfo = { index: number; depth: number; isOuter: boolean; parentIndex: number | null; area: number }
  const infos: SubpathInfo[] = subpaths.map((sp, i) => {
    const probe = sp[0]
    const enclosers: number[] = []
    for (let j = 0; j < subpaths.length; j++) {
      if (i === j) continue
      if (pointInPolygon(probe, subpaths[j])) enclosers.push(j)
    }
    const depth = enclosers.length
    const isOuter = depth % 2 === 0
    let parentIndex: number | null = null
    if (enclosers.length > 0) {
      let bestArea = Infinity
      for (const j of enclosers) {
        const area = Math.abs(signedArea(subpaths[j]))
        if (area < bestArea) {
          bestArea = area
          parentIndex = j
        }
      }
    }
    return { index: i, depth, isOuter, parentIndex, area: Math.abs(signedArea(sp)) }
  })

  console.log("\nSubpath details:")
  for (const inf of infos) {
    console.log(`Subpath #${inf.index}: depth=${inf.depth}, isOuter=${inf.isOuter}, parentIndex=${inf.parentIndex}, area=${inf.area.toFixed(1)}`)
  }
}

main().catch(console.error)
