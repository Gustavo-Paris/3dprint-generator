import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import potrace from 'potrace'
import { computeOtsuThreshold } from '../lib/logo-extrude/otsu'

const COLOR_INK_SAT = 120
const COLOR_INK_FRACTION = 0.01

async function main() {
  const imgPath = path.join(process.cwd(), 'public/uploads/7e3ecc17-f51f-4c4c-87dc-d9fc9480901a.jpg')
  const imageBuffer = fs.readFileSync(imgPath)

  const meta = await sharp(imageBuffer).metadata()
  const fullWidth = meta.width ?? 0
  const fullHeight = meta.height ?? 0

  const rect = { left: 0, top: 0, width: fullWidth, height: fullHeight }

  // Simulate preprocessing
  const { data, info } = await sharp(imageBuffer)
    .extract(rect)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const px = info.width * info.height
  const sat = Buffer.alloc(px)
  let colouredCount = 0
  for (let i = 0, p = 0; p < px; i += info.channels, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const s = mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 255)
    sat[p] = s
    if (s > COLOR_INK_SAT) colouredCount++
  }

  console.log("colouredCount:", colouredCount, "total px:", px, "fraction:", colouredCount / px)

  let grayscale: Buffer
  if (colouredCount / px >= COLOR_INK_FRACTION) {
    console.log("Using COLOUR PATH")
    grayscale = await sharp(sat, {
      raw: { width: info.width, height: info.height, channels: 1 },
    })
      .threshold(COLOR_INK_SAT)
      .negate()
      .png()
      .toBuffer()
  } else {
    console.log("Using LUMA PATH")
    grayscale = await sharp(imageBuffer)
      .extract(rect)
      .flatten({ background: '#ffffff' })
      .grayscale()
      .normalize()
      .blur(0.8)
      .toBuffer()
  }

  // Save the preprocessed image
  fs.writeFileSync('public/debug-preprocessed.png', grayscale)
  console.log("Saved preprocessed image to public/debug-preprocessed.png")

  // Trace
  const rawBytes = await sharp(grayscale).grayscale().raw().toBuffer()
  const traceThreshold = computeOtsuThreshold(new Uint8Array(rawBytes))
  console.log("Trace threshold:", traceThreshold)

  const svg: string = await new Promise((resolve, reject) => {
    potrace.trace(
      grayscale,
      {
        turdSize: 8,
        alphaMax: 1,
        optCurve: true,
        optTolerance: 0.2,
        threshold: traceThreshold,
      },
      (err, s) => (err ? reject(err) : resolve(s)),
    )
  })

  fs.writeFileSync('public/debug-traced.svg', svg)
  console.log("Saved traced SVG to public/debug-traced.svg")
}

main().catch(console.error)
