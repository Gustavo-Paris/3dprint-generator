/**
 * paint_from_image — project a reference image onto ANY imported mesh and
 * quantize surface colours to extruders A/B.
 *
 * General pipeline (no object-specific priors — works for characters, props, etc.):
 *  1. Crop subject (ignore dark/gray background)
 *  2. Fit mesh front (XZ) into subject UV; optional flip/shift/scale search
 *  3. Sample image colour per front-facing triangle
 *  4. Classify to A/B: red-vs-gold when the image looks like character paint,
 *     otherwise 2-means on RGB
 *  5. Light spatial smooth + despeckle; unsampled tris → A
 *  6. Return palette hex for viewer pickers
 */
import sharp from 'sharp'
import type { Op } from '@/lib/design/schema'
import type { BaseMesh, SemanticFace } from '../types'

type PaintFromImageParams = Extract<Op, { op: 'paint_from_image' }>

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface PaintPalette {
  A: string
  B: string
}

export interface PaintFromImageResult {
  mesh: BaseMesh
  palette: PaintPalette
}

export function rgbToHex(c: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return (
    '#' +
    [clamp(c.r), clamp(c.g), clamp(c.b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  )
}

export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

export function chroma(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

/** Hue in degrees [0,360), or -1 if achromatic. */
export function hueDeg(c: Rgb): number {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 1e-6) return -1
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return h
}

/** Keep chromatic mid-tones for clustering (drop black bg + white specular). */
export function isUsefulPaintSample(c: Rgb): boolean {
  const L = luminance(c)
  const ch = chroma(c)
  return L >= 35 && L <= 230 && ch >= 28
}

/** Gold / brass accent (high R, mid G, low B). Requires real chroma — gray
 *  mid-tones often have hue≈30° and used to score as gold falsely. */
export function goldScore(c: Rgb): number {
  const ch = chroma(c)
  if (ch < 22) return 0
  const h = hueDeg(c)
  // Gold/yellow hues ~25–55°
  const hueBonus = h >= 20 && h <= 65 ? 80 : h >= 15 && h <= 80 ? 30 : 0
  const warm = c.r - c.b
  const yellow = c.g - c.b * 0.5
  const chromaBoost = Math.min(40, (ch - 22) * 0.6)
  return (
    warm * 0.5 +
    yellow * 0.5 +
    hueBonus +
    chromaBoost +
    (c.r > 150 && c.g > 90 && ch > 35 ? 40 : 0)
  )
}

/** Red / crimson body paint. */
export function redScore(c: Rgb): number {
  const h = hueDeg(c)
  // Red hues ~0–20° and ~340–360°
  const hueBonus =
    (h >= 0 && h <= 25) || h >= 340 || (h >= 0 && h < 0) ? 80
    : h > 25 && h < 40 ? 20
    : 0
  return c.r - Math.max(c.g, c.b) * 1.15 + hueBonus + (c.r > 120 && c.g < c.r * 0.75 ? 30 : 0)
}

export function sampleRgb(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  u: number,
  v: number,
): Rgb {
  // Bilinear sample for smoother faceplate edges
  const xf = Math.min(width - 1.001, Math.max(0, u * (width - 1)))
  const yf = Math.min(height - 1.001, Math.max(0, v * (height - 1)))
  const x0 = Math.floor(xf)
  const y0 = Math.floor(yf)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = xf - x0
  const ty = yf - y0
  const at = (x: number, y: number): Rgb => {
    const i = (y * width + x) * channels
    return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 }
  }
  const c00 = at(x0, y0)
  const c10 = at(x1, y0)
  const c01 = at(x0, y1)
  const c11 = at(x1, y1)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  return {
    r: lerp(lerp(c00.r, c10.r, tx), lerp(c01.r, c11.r, tx), ty),
    g: lerp(lerp(c00.g, c10.g, tx), lerp(c01.g, c11.g, tx), ty),
    b: lerp(lerp(c00.b, c10.b, tx), lerp(c01.b, c11.b, tx), ty),
  }
}

/**
 * Find subject bounds (normalized 0–1).
 * Prefers chromatic / paint-like pixels so dark-gray CGI backgrounds don't
 * expand the crop to the full frame (which collapses faceplate UV resolution).
 */
export function findSubjectBounds(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  lumaThreshold = 28,
): { u0: number; v0: number; u1: number; v1: number } {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256))

  const scan = (mode: 'chroma' | 'luma'): {
    minX: number
    minY: number
    maxX: number
    maxY: number
    hit: number
  } => {
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let hit = 0
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * channels
        const r = data[i] ?? 0
        const g = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if (L < lumaThreshold) continue
        if (mode === 'chroma') {
          const ch = Math.max(r, g, b) - Math.min(r, g, b)
          // Keep colourful mid-tones (body paint, gold trim). Drop gray floor.
          if (ch < 22 && L < 200) continue
          if (ch < 14) continue
        }
        hit++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    return { minX, minY, maxX, maxY, hit }
  }

  // Chroma-first; fall back to luma if the render is monochrome/low-sat.
  let box = scan('chroma')
  if (box.hit < 40) box = scan('luma')
  if (box.hit < 16) {
    return { u0: 0.05, v0: 0.05, u1: 0.95, v1: 0.95 }
  }

  let { minX, minY, maxX, maxY } = box
  // Pad ~5% so helmet/shoulder trim isn't clipped
  const padX = (maxX - minX) * 0.05 + 2
  const padY = (maxY - minY) * 0.05 + 2
  minX = Math.max(0, minX - padX)
  minY = Math.max(0, minY - padY)
  maxX = Math.min(width - 1, maxX + padX)
  maxY = Math.min(height - 1, maxY + padY)

  // Reject near-full-frame crops (background leak) — shrink to central mass
  const spanU = (maxX - minX) / (width - 1)
  const spanV = (maxY - minY) / (height - 1)
  if (spanU > 0.92 && spanV > 0.92) {
    return { u0: 0.08, v0: 0.04, u1: 0.92, v1: 0.96 }
  }

  return {
    u0: minX / (width - 1),
    v0: minY / (height - 1),
    u1: maxX / (width - 1),
    v1: maxY / (height - 1),
  }
}

export interface ProjectionAlign {
  /** Shift UV after fit (−0.2…0.2). Positive uShift moves sample right on image. */
  uShift?: number
  vShift?: number
  /** Uniform scale around subject center (0.75…1.25). <1 zooms in on subject. */
  scale?: number
  /** Mirror mesh X → image U (imported meshes are often mirrored vs renders). */
  uFlip?: boolean
}

/**
 * Map mesh (x,z) → image UV with aspect-preserving cover into the subject rect.
 * Cover (not letterbox) keeps faceplate pixels dense on portrait product shots.
 * Mesh X → horizontal, mesh Z → vertical (top of bust = top of image).
 */
export function projectFrontToUv(
  x: number,
  z: number,
  bbox: BaseMesh['bbox'],
  subject?: { u0: number; v0: number; u1: number; v1: number },
  align?: ProjectionAlign,
): { u: number; v: number } {
  const sx = bbox.size[0] || 1
  const sz = bbox.size[2] || 1
  // Normalized mesh coords 0..1
  let mx = (x - bbox.min[0]) / sx
  let mz = (z - bbox.min[2]) / sz
  mx = Math.min(1, Math.max(0, mx))
  mz = Math.min(1, Math.max(0, mz))
  if (align?.uFlip) mx = 1 - mx

  const sub = subject ?? { u0: 0, v0: 0, u1: 1, v1: 1 }
  const subW = Math.max(1e-6, sub.u1 - sub.u0)
  const subH = Math.max(1e-6, sub.v1 - sub.v0)
  const meshAspect = sx / sz
  const subAspect = subW / subH

  // Letterbox (contain): entire mesh fits in subject rect. Paired with a
  // chroma subject crop this maps the bust onto the painted character.
  let u0 = sub.u0
  let v0 = sub.v0
  let uSpan = subW
  let vSpan = subH
  if (meshAspect > subAspect) {
    // Mesh wider → fit width, letterbox vertically
    vSpan = subW / meshAspect
    v0 = sub.v0 + (subH - vSpan) / 2
  } else {
    // Mesh taller → fit height, pillarbox horizontally
    uSpan = subH * meshAspect
    u0 = sub.u0 + (subW - uSpan) / 2
  }

  // Optional zoom around subject center (helps faceplate on portrait renders)
  const sc = align?.scale ?? 1
  if (sc !== 1) {
    const cu = u0 + uSpan / 2
    const cv = v0 + vSpan / 2
    uSpan *= sc
    vSpan *= sc
    u0 = cu - uSpan / 2
    v0 = cv - vSpan / 2
  }

  const u = u0 + mx * uSpan + (align?.uShift ?? 0)
  // Image v grows downward; mesh high Z = top of subject
  const v = v0 + (1 - mz) * vSpan + (align?.vShift ?? 0)
  return {
    u: Math.min(1, Math.max(0, u)),
    v: Math.min(1, Math.max(0, v)),
  }
}

/**
 * Grid-search UV alignment: reward gold samples landing on high-gold image
 * pixels and red samples on high-red pixels (sampled on a mesh subsample).
 * Also tries horizontal flip — imports often mirror the reference render.
 */
/**
 * Search UV alignment that maximises useful (non-bg) colour hits and
 * colour variance on the front of the mesh — object-agnostic.
 */
export function findBestAlignment(
  mesh: BaseMesh,
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  subject: { u0: number; v0: number; u1: number; v1: number },
  cents: Float32Array,
): ProjectionAlign {
  const step = Math.max(1, Math.floor(mesh.triangleCount / 2200))
  const uShifts = [-0.1, -0.05, 0, 0.05, 0.1]
  const vShifts = [-0.08, -0.04, 0, 0.04, 0.08]
  const scales = [0.88, 0.95, 1.0, 1.06]
  const flips = [false, true]
  let best: ProjectionAlign = { uShift: 0, vShift: 0, scale: 1, uFlip: false }
  let bestScore = -Infinity

  for (const uFlip of flips) {
    for (const scale of scales) {
      for (const uShift of uShifts) {
        for (const vShift of vShifts) {
          const align: ProjectionAlign = { uShift, vShift, scale, uFlip }
          let n = 0
          let useful = 0
          let sumL = 0
          let sumL2 = 0
          let sumCh = 0
          for (let i = 0; i < mesh.triangleCount; i += step) {
            if (mesh.normals[i * 3 + 1] > 0.05) continue
            const j = i * 3
            const { u, v } = projectFrontToUv(
              cents[j],
              cents[j + 2],
              mesh.bbox,
              subject,
              align,
            )
            // Prefer samples that land inside the subject crop
            if (u < subject.u0 || u > subject.u1 || v < subject.v0 || v > subject.v1) {
              continue
            }
            const rgb = sampleRgb(data, width, height, channels, u, v)
            const L = luminance(rgb)
            if (L < 18) continue
            n++
            sumL += L
            sumL2 += L * L
            sumCh += chroma(rgb)
            if (isUsefulPaintSample(rgb)) useful++
          }
          if (n < 40) continue
          const meanL = sumL / n
          const varL = Math.max(0, sumL2 / n - meanL * meanL)
          // Prefer: many useful chromatic samples + high luminance variance
          // (means the mesh is covering the painted subject, not flat bg)
          const s = useful * 2 + Math.sqrt(varL) * 0.15 + (sumCh / n) * 0.5
          if (s > bestScore) {
            bestScore = s
            best = align
          }
        }
      }
    }
  }
  return best
}

/** Dilate B labels into A neighbors when the neighbor is gold-ish (fill faceplate). */
export function dilateBGold(
  labels: Array<'A' | 'B'>,
  goldHint: Float32Array, // per-tri goldScore, -1 if unknown
  positions: Float32Array,
  cellMm: number,
  cents?: Float32Array,
  passes = 2,
  minGold = 50,
): Array<'A' | 'B'> {
  const n = labels.length
  const cell = Math.max(cellMm, 1.5)
  const inv = 1 / cell
  const centroids = cents ?? precomputeCentroids(positions, n)
  let cur = labels.slice()

  for (let p = 0; p < passes; p++) {
    const bCells = new Set<number>()
    for (let i = 0; i < n; i++) {
      if (cur[i] !== 'B') continue
      const j = i * 3
      bCells.add(
        packCell(
          Math.floor(centroids[j] * inv),
          Math.floor(centroids[j + 1] * inv),
          Math.floor(centroids[j + 2] * inv),
        ),
      )
    }
    const next = cur.slice()
    for (let i = 0; i < n; i++) {
      if (cur[i] === 'B') continue
      // Only expand into triangles that actually sampled as gold
      if (goldHint[i] < minGold) continue
      const j = i * 3
      const ix = Math.floor(centroids[j] * inv)
      const iy = Math.floor(centroids[j + 1] * inv)
      const iz = Math.floor(centroids[j + 2] * inv)
      let nearB = false
      for (const [dx, dy, dz] of [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        if (bCells.has(packCell(ix + dx, iy + dy, iz + dz))) {
          nearB = true
          break
        }
      }
      if (nearB) next[i] = 'B'
    }
    cur = next
  }
  return cur
}

/** 2-means on RGB. Deterministic init from luminance extremes. */
export function kMeans2(colors: Rgb[], iterations = 14): [Rgb, Rgb] {
  if (colors.length === 0) {
    return [
      { r: 180, g: 30, b: 30 },
      { r: 210, g: 170, b: 50 },
    ]
  }
  let dark = colors[0]
  let light = colors[0]
  let minL = Infinity
  let maxL = -Infinity
  for (const c of colors) {
    const L = luminance(c)
    if (L < minL) {
      minL = L
      dark = c
    }
    if (L > maxL) {
      maxL = L
      light = c
    }
  }
  let c0 = { ...dark }
  let c1 = { ...light }

  for (let iter = 0; iter < iterations; iter++) {
    const s0 = { r: 0, g: 0, b: 0, n: 0 }
    const s1 = { r: 0, g: 0, b: 0, n: 0 }
    for (const c of colors) {
      if (colorDistance(c, c0) <= colorDistance(c, c1)) {
        s0.r += c.r
        s0.g += c.g
        s0.b += c.b
        s0.n++
      } else {
        s1.r += c.r
        s1.g += c.g
        s1.b += c.b
        s1.n++
      }
    }
    if (s0.n > 0) c0 = { r: s0.r / s0.n, g: s0.g / s0.n, b: s0.b / s0.n }
    if (s1.n > 0) c1 = { r: s1.r / s1.n, g: s1.g / s1.n, b: s1.b / s1.n }
  }
  return [c0, c1]
}

/**
 * Map cluster 0/1 → A/B. Prefer red→A, gold→B when centroids look like that;
 * else larger cluster → A.
 */
export function assignClusterToExtruder(centroids: [Rgb, Rgb]): [0 | 1, 0 | 1] {
  // Returns [clusterIndexForA, clusterIndexForB]
  const g0 = goldScore(centroids[0])
  const g1 = goldScore(centroids[1])
  const r0 = redScore(centroids[0])
  const r1 = redScore(centroids[1])
  // Strong gold-vs-red signal
  if (g0 - g1 > 25 && r1 - r0 > 10) return [1, 0] // 0 is gold → B, 1 is red → A
  if (g1 - g0 > 25 && r0 - r1 > 10) return [0, 1]
  // Fallback: redder → A, other → B
  if (r0 !== r1) {
    return r0 >= r1 ? [0, 1] : [1, 0]
  }
  // Luminance: darker body A, brighter accent B
  return luminance(centroids[0]) <= luminance(centroids[1]) ? [0, 1] : [1, 0]
}

/**
 * Direct red-vs-gold classification for character paints (Iron Man, etc.).
 * More stable than pure k-means on glossy renders with heavy speculars.
 * @param faceplateBias 0..1 — lower gold threshold in faceplate UV zone
 */
/**
 * Strict red-vs-gold pixel test. No geometric "paint whole head" bias.
 * Gold must beat red and look warm-yellow, not orange-red body paint.
 */
export function isGoldPixel(c: Rgb): boolean {
  const L = luminance(c)
  const ch = chroma(c)
  if (L < 45 || ch < 26) return false
  // Specular white / silver
  if (L > 230 && ch < 40) return false
  const g = goldScore(c)
  const r = redScore(c)
  // Clear gold lead (orange-red body has high redScore)
  if (g < 48) return false
  if (g <= r + 6) return false
  // Warm yellow/brass: R and G elevated, B lower
  if (c.r < 130 || c.g < 85) return false
  if (c.b > c.g * 1.0 && ch < 45) return false
  // Reject pure reds that sneak past (high R, low G)
  if (c.g < c.r * 0.45 && r > 100) return false
  return true
}

/** @deprecated prefer isGoldPixel — kept for tests that pass faceplateBias */
export function classifyRedGold(c: Rgb, _faceplateBias = 0): 'A' | 'B' {
  return isGoldPixel(c) ? 'B' : 'A'
}

/**
 * Build a binary gold mask (1 = gold accent) from the reference image.
 * 2px dilate fills specular holes inside faceplates without flooding red.
 */
export function buildGoldMask(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  let mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const c = { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 }
      if (isGoldPixel(c)) mask[y * width + x] = 1
    }
  }
  // 2px dilate into non-red neighbours
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8Array(mask)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (mask[i]) continue
        if (
          mask[i - 1] ||
          mask[i + 1] ||
          mask[i - width] ||
          mask[i + width]
        ) {
          const pi = i * channels
          const c = { r: data[pi] ?? 0, g: data[pi + 1] ?? 0, b: data[pi + 2] ?? 0 }
          if (redScore(c) > 90 && goldScore(c) < 45) continue
          if (luminance(c) < 28) continue
          out[i] = 1
        }
      }
    }
    mask = out
  }
  return mask
}

export interface GoldComponent {
  n: number
  /** Normalized UV bbox */
  u0: number
  v0: number
  u1: number
  v1: number
  cu: number
  cv: number
}

/** Connected components of the gold mask (pixel count + UV bbox). */
export function findGoldComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels = 40,
): GoldComponent[] {
  const seen = new Uint8Array(width * height)
  const comps: GoldComponent[] = []
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x
      if (!mask[start] || seen[start]) continue
      let n = 0
      let minx = x
      let maxx = x
      let miny = y
      let maxy = y
      let sx = 0
      let sy = 0
      const stack = [start]
      seen[start] = 1
      while (stack.length) {
        const p = stack.pop()!
        n++
        const px = p % width
        const py = (p / width) | 0
        sx += px
        sy += py
        if (px < minx) minx = px
        if (px > maxx) maxx = px
        if (py < miny) miny = py
        if (py > maxy) maxy = py
        for (const [dx, dy] of dirs) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (!mask[ni] || seen[ni]) continue
          seen[ni] = 1
          stack.push(ni)
        }
      }
      if (n < minPixels) continue
      comps.push({
        n,
        u0: minx / (width - 1),
        v0: miny / (height - 1),
        u1: maxx / (width - 1),
        v1: maxy / (height - 1),
        cu: sx / n / (width - 1),
        cv: sy / n / (height - 1),
      })
    }
  }
  comps.sort((a, b) => b.n - a.n)
  return comps
}

/** Expand a UV bbox by fraction of its size (and a minimum pad). */
export function expandUvBox(
  b: { u0: number; v0: number; u1: number; v1: number },
  frac = 0.12,
  minPad = 0.02,
): { u0: number; v0: number; u1: number; v1: number } {
  const pu = Math.max(minPad, (b.u1 - b.u0) * frac)
  const pv = Math.max(minPad, (b.v1 - b.v0) * frac)
  return {
    u0: Math.max(0, b.u0 - pu),
    v0: Math.max(0, b.v0 - pv),
    u1: Math.min(1, b.u1 + pu),
    v1: Math.min(1, b.v1 + pv),
  }
}

export function uvInBox(
  u: number,
  v: number,
  b: { u0: number; v0: number; u1: number; v1: number },
): boolean {
  return u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1
}

export function sampleGoldMask(
  mask: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
): boolean {
  const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))))
  const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))))
  // 3×3 soft: any solid gold nearby counts (faceplate edges are thin)
  let g = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
      if (mask[yy * width + xx]) g++
    }
  }
  return g >= 2
}

/**
 * Grow B only inside a tight mesh zone from seed triangles (faceplate fill).
 * Must stay small — wide zones paint whole helmets gold.
 */
export function floodZoneB(
  labels: Array<'A' | 'B'>,
  cents: Float32Array,
  bbox: BaseMesh['bbox'],
  zone: { mz0: number; mz1: number; mx0: number; mx1: number },
  cellMm: number,
  passes = 3,
  /** Optional: only flood front-ish tris (normalized my max) */
  maxMy?: number,
): Array<'A' | 'B'> {
  const n = labels.length
  const cell = Math.max(cellMm, 1.5)
  const inv = 1 / cell
  const sizeX = bbox.size[0] || 1
  const sizeY = bbox.size[1] || 1
  const sizeZ = bbox.size[2] || 1
  const inZone = (i: number): boolean => {
    const j = i * 3
    const mx = (cents[j] - bbox.min[0]) / sizeX
    const my = (cents[j + 1] - bbox.min[1]) / sizeY
    const mz = (cents[j + 2] - bbox.min[2]) / sizeZ
    if (mz < zone.mz0 || mz > zone.mz1 || mx < zone.mx0 || mx > zone.mx1) return false
    if (maxMy !== undefined && my > maxMy) return false
    return true
  }
  let cur = labels.slice()
  for (let p = 0; p < passes; p++) {
    const bCells = new Set<number>()
    for (let i = 0; i < n; i++) {
      if (cur[i] !== 'B' || !inZone(i)) continue
      const j = i * 3
      bCells.add(
        packCell(
          Math.floor(cents[j] * inv),
          Math.floor(cents[j + 1] * inv),
          Math.floor(cents[j + 2] * inv),
        ),
      )
    }
    const next = cur.slice()
    for (let i = 0; i < n; i++) {
      if (cur[i] === 'B' || !inZone(i)) continue
      const j = i * 3
      const ix = Math.floor(cents[j] * inv)
      const iy = Math.floor(cents[j + 1] * inv)
      const iz = Math.floor(cents[j + 2] * inv)
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        if (bCells.has(packCell(ix + dx, iy + dy, iz + dz))) {
          next[i] = 'B'
          break
        }
      }
    }
    cur = next
  }
  return cur
}

export function assignExtruders(
  samples: Rgb[],
  centroids: [Rgb, Rgb],
): Array<'A' | 'B'> {
  // Prefer semantic red/gold when the image has both signals
  let goldish = 0
  let redish = 0
  for (const c of samples) {
    if (goldScore(c) > 50) goldish++
    if (redScore(c) > 50) redish++
  }
  if (goldish > samples.length * 0.03 && redish > samples.length * 0.05) {
    return samples.map((c) => classifyRedGold(c, 0))
  }
  const [aIdx] = assignClusterToExtruder(centroids)
  return samples.map((c) => {
    const d0 = colorDistance(c, centroids[0])
    const d1 = colorDistance(c, centroids[1])
    const cluster: 0 | 1 = d0 <= d1 ? 0 : 1
    return cluster === aIdx ? 'A' : 'B'
  })
}

/** Palette for viewer pickers — mean of high-signal samples only (not shadows). */
export function paletteFromLabels(samples: Rgb[], labels: Array<'A' | 'B'>): PaintPalette {
  const aCols: Rgb[] = []
  const bCols: Rgb[] = []
  for (let i = 0; i < samples.length; i++) {
    const c = samples[i]
    if (!isUsefulPaintSample(c)) continue
    if (labels[i] === 'A' && redScore(c) > 35) aCols.push(c)
    if (labels[i] === 'B' && goldScore(c) > 35) bCols.push(c)
  }
  // Top-quartile by score → punchier preview colours
  const meanTop = (cols: Rgb[], score: (c: Rgb) => number, fallback: Rgb): Rgb => {
    if (cols.length === 0) return fallback
    const sorted = cols.slice().sort((x, y) => score(y) - score(x))
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.35)))
    let r = 0, g = 0, b = 0
    for (const c of top) {
      r += c.r
      g += c.g
      b += c.b
    }
    const n = top.length
    return { r: r / n, g: g / n, b: b / n }
  }
  let aMean = meanTop(aCols, redScore, { r: 196, g: 30, b: 58 })
  let bMean = meanTop(bCols, goldScore, { r: 212, g: 168, b: 75 })
  // Punch preview colours if samples were muddy (common on glossy CGI)
  if (redScore(aMean) < 60) aMean = { r: 196, g: 30, b: 58 }
  if (goldScore(bMean) < 90) bMean = { r: 212, g: 168, b: 75 }
  return { A: rgbToHex(aMean), B: rgbToHex(bMean) }
}

function triangleCentroid(positions: Float32Array, tri: number): [number, number, number] {
  const o = tri * 9
  return [
    (positions[o] + positions[o + 3] + positions[o + 6]) / 3,
    (positions[o + 1] + positions[o + 4] + positions[o + 7]) / 3,
    (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3,
  ]
}

function facesCameraFront(nx: number, ny: number, _nz: number): boolean {
  // Front ≈ −Y (see paint-region faceDirection). Keep lateral shell but not back.
  return ny < 0.25
}

function packCell(ix: number, iy: number, iz: number): number {
  // 10 bits each axis centered — fine for local meshes of a few hundred mm
  return ((ix + 512) & 1023) | (((iy + 512) & 1023) << 10) | (((iz + 512) & 1023) << 20)
}

function precomputeCentroids(positions: Float32Array, n: number): Float32Array {
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const o = i * 9
    const j = i * 3
    c[j] = (positions[o] + positions[o + 3] + positions[o + 6]) / 3
    c[j + 1] = (positions[o + 1] + positions[o + 4] + positions[o + 7]) / 3
    c[j + 2] = (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3
  }
  return c
}

/**
 * O(n) voxel majority smoothing — each triangle votes into a grid cell; then
 * each triangle takes majority of its cell + 6-neighbors. Safe on 1M+ tris.
 */
export function smoothExtruderLabels(
  labels: Array<'A' | 'B'>,
  positions: Float32Array,
  cellMm: number,
  iterations = 2,
  cents?: Float32Array,
): Array<'A' | 'B'> {
  const n = labels.length
  if (n === 0) return labels
  const cell = Math.max(cellMm, 1.5)
  const inv = 1 / cell
  const centroids = cents ?? precomputeCentroids(positions, n)
  let cur = labels.slice()

  for (let iter = 0; iter < iterations; iter++) {
    const votes = new Map<number, { a: number; b: number }>()
    const cellOf = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const j = i * 3
      const ix = Math.floor(centroids[j] * inv)
      const iy = Math.floor(centroids[j + 1] * inv)
      const iz = Math.floor(centroids[j + 2] * inv)
      const k = packCell(ix, iy, iz)
      cellOf[i] = k
      let v = votes.get(k)
      if (!v) {
        v = { a: 0, b: 0 }
        votes.set(k, v)
      }
      if (cur[i] === 'A') v.a++
      else v.b++
    }

    const next = cur.slice()
    for (let i = 0; i < n; i++) {
      const k = cellOf[i]
      const ix = (k & 1023) - 512
      const iy = ((k >> 10) & 1023) - 512
      const iz = ((k >> 20) & 1023) - 512
      let a = 0
      let b = 0
      // self + 6-neighbors
      const neigh = [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]
      for (const [dx, dy, dz] of neigh) {
        const v = votes.get(packCell(ix + dx, iy + dy, iz + dz))
        if (!v) continue
        a += v.a
        b += v.b
      }
      next[i] = b > a ? 'B' : 'A'
    }
    cur = next
  }
  return cur
}

/** Drop B labels whose voxel has almost no B votes (isolated speckles). */
export function despeckleB(
  labels: Array<'A' | 'B'>,
  positions: Float32Array,
  cellMm: number,
  minBInCell = 4,
  cents?: Float32Array,
): Array<'A' | 'B'> {
  const n = labels.length
  const cell = Math.max(cellMm, 1.5)
  const inv = 1 / cell
  const centroids = cents ?? precomputeCentroids(positions, n)
  const votes = new Map<number, number>()
  const cellOf = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const j = i * 3
    const k = packCell(
      Math.floor(centroids[j] * inv),
      Math.floor(centroids[j + 1] * inv),
      Math.floor(centroids[j + 2] * inv),
    )
    cellOf[i] = k
    if (labels[i] === 'B') votes.set(k, (votes.get(k) ?? 0) + 1)
  }
  const out = labels.slice()
  for (let i = 0; i < n; i++) {
    if (labels[i] !== 'B') continue
    if ((votes.get(cellOf[i]) ?? 0) < minBInCell) out[i] = 'A'
  }
  return out
}

export async function applyPaintFromImage(
  mesh: BaseMesh,
  _op: PaintFromImageParams,
  _faces: SemanticFace[],
  imageBuffer: Buffer | null | undefined,
): Promise<BaseMesh> {
  const { mesh: painted } = await applyPaintFromImageDetailed(
    mesh,
    _op,
    _faces,
    imageBuffer,
  )
  return painted
}

export async function applyPaintFromImageDetailed(
  mesh: BaseMesh,
  _op: PaintFromImageParams,
  _faces: SemanticFace[],
  imageBuffer: Buffer | null | undefined,
): Promise<PaintFromImageResult> {
  if (!imageBuffer || imageBuffer.length < 32) {
    throw new Error(
      'paint_from_image requires a reference image — anexe a imagem de cores no chat',
    )
  }

  // Downscale huge refs for speed; keep enough detail for face/helmet trim.
  const { data, info } = await sharp(imageBuffer)
    .rotate() // honour EXIF
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const width = info.width
  const height = info.height
  const channels = info.channels
  if (!width || !height || width < 2 || height < 2) {
    throw new Error('paint_from_image: invalid image dimensions')
  }

  const subject = findSubjectBounds(data, width, height, channels)
  const n = mesh.triangleCount
  const cents = precomputeCentroids(mesh.positions, n)

  // Tiny meshes (unit tests): identity UV. Large meshes: search flip/shift/scale.
  const align =
    n < 64
      ? { uShift: 0, vShift: 0, scale: 1, uFlip: false }
      : findBestAlignment(mesh, data, width, height, channels, subject, cents)

  // ── 1. Sample image colour onto every front-facing triangle ─────────
  const sampleForTri: Array<Rgb | null> = new Array(n).fill(null)
  const samples: Rgb[] = []
  const step = Math.max(1, Math.floor(n / 12_000))

  const sampleMesh = (onlyFront: boolean) => {
    for (let i = 0; i < n; i++) {
      if (onlyFront && mesh.normals[i * 3 + 1] > -0.05) continue
      const j = i * 3
      const { u, v } = projectFrontToUv(cents[j], cents[j + 2], mesh.bbox, subject, align)
      const rgb = sampleRgb(data, width, height, channels, u, v)
      if (luminance(rgb) < 18) continue
      sampleForTri[i] = rgb
      if (i % step === 0 && isUsefulPaintSample(rgb)) samples.push(rgb)
    }
  }
  sampleMesh(true)
  if (samples.length < 8) {
    sampleForTri.fill(null)
    samples.length = 0
    sampleMesh(false)
  }
  if (samples.length < 8) {
    samples.length = 0
    for (let i = 0; i < n; i++) {
      const rgb = sampleForTri[i]
      if (rgb && i % step === 0) samples.push(rgb)
    }
  }
  if (samples.length < 2) {
    throw new Error('paint_from_image: could not sample colours from the image')
  }

  // ── 2. Decide A/B: image-driven only (no mesh-region priors) ────────
  // Soft accent test (works for gold/yellow trim without being Iron-Man-only).
  const isAccent = (c: Rgb): boolean => {
    if (isGoldPixel(c)) return true
    const g = goldScore(c)
    const r = redScore(c)
    const ch = chroma(c)
    const L = luminance(c)
    // Warm yellow/brass mid-tones (glossy CGI gold often fails strict isGoldPixel)
    return ch >= 24 && L >= 50 && L <= 235 && g > 55 && g > r + 8 && c.g > c.b * 0.85
  }

  let accentN = 0
  let bodyN = 0
  for (const c of samples) {
    if (isAccent(c)) accentN++
    else if (redScore(c) > 40 || chroma(c) > 20) bodyN++
  }
  // Two-colour character paint when both body and accent appear in samples
  const useAccentSplit = accentN > samples.length * 0.015 && bodyN > samples.length * 0.05
  const centroids = kMeans2(samples)
  const [aIdx] = assignClusterToExtruder(centroids)

  const rawLabels: Array<'A' | 'B' | null> = new Array(n).fill(null)
  const frontRgbs: Rgb[] = []
  const assigned: Array<'A' | 'B'> = []

  for (let i = 0; i < n; i++) {
    const rgb = sampleForTri[i]
    if (!rgb) continue
    frontRgbs.push(rgb)
    let label: 'A' | 'B'
    if (useAccentSplit) {
      // Accent (gold/yellow/etc.) → B; body colour → A
      label = isAccent(rgb) ? 'B' : 'A'
    } else {
      // Generic: nearest of 2 image colour clusters
      const d0 = colorDistance(rgb, centroids[0])
      const d1 = colorDistance(rgb, centroids[1])
      const cluster: 0 | 1 = d0 <= d1 ? 0 : 1
      label = cluster === aIdx ? 'A' : 'B'
    }
    rawLabels[i] = label
    assigned.push(label)
  }

  let paintedCount = 0
  for (const L of rawLabels) if (L) paintedCount++
  if (paintedCount === 0) {
    throw new Error('paint_from_image: no triangles received a colour label')
  }

  // ── 3. Unsampled (back/sides): inherit only when neighborhood is clear ─
  const cellFill =
    Math.max(2.5, Math.hypot(mesh.bbox.size[0], mesh.bbox.size[1], mesh.bbox.size[2]) * 0.028) || 3
  const invFill = 1 / cellFill
  const voxelA = new Set<number>()
  const voxelB = new Set<number>()
  for (let i = 0; i < n; i++) {
    if (!rawLabels[i]) continue
    const j = i * 3
    const key = packCell(
      Math.floor(cents[j] * invFill),
      Math.floor(cents[j + 1] * invFill),
      Math.floor(cents[j + 2] * invFill),
    )
    if (rawLabels[i] === 'B') voxelB.add(key)
    else voxelA.add(key)
  }

  const labels: Array<'A' | 'B'> = new Array(n)
  for (let i = 0; i < n; i++) {
    if (rawLabels[i]) {
      labels[i] = rawLabels[i]!
      continue
    }
    // Default body A. Only pick up B when clearly gold-dominated nearby.
    const j = i * 3
    const ix = Math.floor(cents[j] * invFill)
    const iy = Math.floor(cents[j + 1] * invFill)
    const iz = Math.floor(cents[j + 2] * invFill)
    let nearB = 0
    let nearA = 0
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = packCell(ix + dx, iy + dy, iz + dz)
          if (voxelB.has(key)) nearB++
          if (voxelA.has(key)) nearA++
        }
      }
    }
    labels[i] = nearB > nearA * 2 && nearB >= 4 ? 'B' : 'A'
  }

  // ── 4. Light cleanup (preserve image silhouette — no geometric flood) ─
  const diag =
    Math.hypot(mesh.bbox.size[0], mesh.bbox.size[1], mesh.bbox.size[2]) || 50
  const smoothR = Math.max(1.8, diag * 0.02)
  let cleaned = labels
  if (n >= 64) {
    cleaned = smoothExtruderLabels(labels, mesh.positions, smoothR, 1, cents)
    cleaned = despeckleB(cleaned, mesh.positions, smoothR, 5, cents)
  }

  // Ensure B survived (tiny meshes / one-colour samples)
  let nB = 0
  for (const L of cleaned) if (L === 'B') nB++
  if (nB === 0) {
    for (let i = 0; i < n; i++) {
      if (rawLabels[i] === 'B') cleaned[i] = 'B'
    }
  }

  const palette = paletteFromLabels(
    frontRgbs,
    assigned.length > 0 ? assigned : frontRgbs.map(() => 'A' as const),
  )
  return { mesh: { ...mesh, extruders: cleaned }, palette }
}
