import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { computeOtsuThreshold } from '../lib/logo-extrude/otsu'

async function main() {
  const file = path.join(process.cwd(), 'public/debug-preprocessed.png')
  const buffer = fs.readFileSync(file)

  const { data, info } = await sharp(buffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  console.log("Image info:", info)

  // Print histogram of raw values
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < data.length; i++) {
    hist[data[i]]++
  }

  console.log("Non-zero histogram entries:")
  for (let i = 0; i < 256; i++) {
    if (hist[i] > 0) {
      console.log(`  Value ${i}: ${hist[i]} pixels`)
    }
  }

  const threshold = computeOtsuThreshold(new Uint8Array(data))
  console.log("Computed Otsu threshold:", threshold)
}

main().catch(console.error)
