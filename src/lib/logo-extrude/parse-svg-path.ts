/**
 * Minimal SVG path parser tailored for potrace output.
 *
 * Potrace emits paths using only M (moveto), L (lineto), C (cubic bezier), and
 * sometimes Z (close). All coordinates are absolute. We sample cubic curves at
 * a fixed step count and return each subpath as a closed polygon (list of
 * vertices, last not duplicated — JSCAD will close it).
 *
 * SVG Y axis points DOWN. The caller (extrude.ts) flips Y when building the
 * geom2 so the resulting polygon is right-side-up.
 */

export type Pt = [number, number]

const CURVE_SAMPLES = 12

function cubicBezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  return [
    uu * u * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + tt * t * p3[0],
    uu * u * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + tt * t * p3[1],
  ]
}

export function parseSvgPath(d: string): Pt[][] {
  const tokens = d.match(/[MLCZmlcz][^MLCZmlcz]*/g) ?? []

  const subpaths: Pt[][] = []
  let current: Pt[] = []
  let pos: Pt = [0, 0]
  let start: Pt = [0, 0]

  const numsOf = (tok: string): number[] =>
    tok
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parseFloat)

  for (const tok of tokens) {
    const cmd = tok[0]
    const nums = numsOf(tok)
    const rel = cmd === cmd.toLowerCase()

    if (cmd === 'M' || cmd === 'm') {
      if (current.length > 2) subpaths.push(current)
      current = []
      for (let i = 0; i < nums.length; i += 2) {
        let x = nums[i]
        let y = nums[i + 1]
        if (rel) {
          x += pos[0]
          y += pos[1]
        }
        pos = [x, y]
        if (i === 0) start = [x, y]
        current.push([x, y])
      }
    } else if (cmd === 'L' || cmd === 'l') {
      for (let i = 0; i < nums.length; i += 2) {
        let x = nums[i]
        let y = nums[i + 1]
        if (rel) {
          x += pos[0]
          y += pos[1]
        }
        pos = [x, y]
        current.push([x, y])
      }
    } else if (cmd === 'C' || cmd === 'c') {
      for (let i = 0; i < nums.length; i += 6) {
        let x1 = nums[i]
        let y1 = nums[i + 1]
        let x2 = nums[i + 2]
        let y2 = nums[i + 3]
        let x3 = nums[i + 4]
        let y3 = nums[i + 5]
        if (rel) {
          x1 += pos[0]; y1 += pos[1]
          x2 += pos[0]; y2 += pos[1]
          x3 += pos[0]; y3 += pos[1]
        }
        const p0 = pos
        const p1: Pt = [x1, y1]
        const p2: Pt = [x2, y2]
        const p3: Pt = [x3, y3]
        for (let s = 1; s <= CURVE_SAMPLES; s++) {
          current.push(cubicBezier(p0, p1, p2, p3, s / CURVE_SAMPLES))
        }
        pos = p3
      }
    } else if (cmd === 'Z' || cmd === 'z') {
      pos = [...start]
    }
  }

  if (current.length > 2) subpaths.push(current)
  return subpaths
}

/**
 * Signed area of a polygon (standard convention).
 *   positive → counter-clockwise traversal
 *   negative → clockwise
 *
 * Uses the shoelace formula: A = 0.5 * sum(x_i * y_{i+1} - x_{i+1} * y_i).
 */
export function signedArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[(i + 1) % poly.length]
    a += xi * yj - xj * yi
  }
  return a / 2
}

/** Ray-cast point-in-polygon. */
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  const [px, py] = pt
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
