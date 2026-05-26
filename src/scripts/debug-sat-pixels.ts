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

  // Find a line in the middle of the image (y = height / 2)
  const y = Math.floor(info.height / 2)
  console.log("Image width:", info.width, "height:", info.height, "channels:", info.channels)
  console.log(`Analyzing horizontal line at y = ${y}:`)

  let output = ""
  for (let x = 0; x < info.width; x++) {
    const idx = (y * info.width + x) * info.channels
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const s = mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 255)
    
    // Output a character representing saturation:
    // ' ' for very low, '.' for low, '*' for medium, '#' for high
    if (s > 200) output += "#"
    else if (s > 120) output += "*"
    else if (s > 50) output += "."
    else output += " "
  }
  console.log(output)
}

main().catch(console.error)
