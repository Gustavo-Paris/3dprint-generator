import fs from 'fs'
import path from 'path'
import { parse3mf } from '../lib/3mf/parse-3mf'

function getBbox(positions: Float32Array) {
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i+1]
    const z = positions[i+2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, count: positions.length / 3 }
}

async function main() {
  const filePath = path.join(process.cwd(), 'public/meshes/4b130e6b-6ab1-49e8-ba94-4594b124802d.3mf')
  console.log("Reading 3MF file from:", filePath)
  if (!fs.existsSync(filePath)) {
    console.error("File does not exist!")
    return
  }

  const bytes = fs.readFileSync(filePath)
  const bodies = parse3mf(bytes)
  console.log("Parsed bodies:", bodies.length)
  for (const b of bodies) {
    console.log(`Body "${b.label}" (extruder ${b.extruder}):`)
    console.log("  Positions length:", b.positions.length)
    console.log("  Bbox:", getBbox(b.positions))
  }
}

main().catch(console.error)
