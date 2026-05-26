import fs from 'fs'
import path from 'path'
import { parse3mf } from '../lib/3mf/parse-3mf'
import { serializeBinarySTL } from '../lib/stl/serialize'

async function main() {
  const filePath = path.join(process.cwd(), 'public/meshes/4b130e6b-6ab1-49e8-ba94-4594b124802d.3mf')
  if (!fs.existsSync(filePath)) {
    console.error("3MF file does not exist!")
    return
  }

  const bytes = fs.readFileSync(filePath)
  const bodies = parse3mf(bytes)
  const logoBody = bodies.find(b => b.extruder === 'B')
  if (!logoBody) {
    console.error("No logo body found!")
    return
  }

  console.log("Found logo body. Exporting to STL...")
  const stlBytes = serializeBinarySTL(Array.from(logoBody.positions))
  const outPath = path.join(process.cwd(), 'public/debug-logo.stl')
  fs.writeFileSync(outPath, Buffer.from(stlBytes))
  console.log("Logo body exported to:", outPath)
}

main().catch(console.error)
