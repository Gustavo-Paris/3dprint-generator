import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

async function main() {
  const imgPath = path.join(process.cwd(), 'public/uploads/7e3ecc17-f51f-4c4c-87dc-d9fc9480901a.jpg')
  const imageBuffer = fs.readFileSync(imgPath)

  const { data, info } = await sharp(imageBuffer)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const px = info.width * info.height
  const sat = Buffer.alloc(px)
  for (let i = 0, p = 0; p < px; i += info.channels, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const s = mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 255)
    sat[p] = s
  }

  await sharp(sat, {
    raw: { width: info.width, height: info.height, channels: 1 }
  })
    .png()
    .toFile('public/debug-sat.png')
  console.log("Saved raw saturation to public/debug-sat.png")
}

main().catch(console.error)
