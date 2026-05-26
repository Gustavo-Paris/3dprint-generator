/**
 * Otsu's method for automatic binarization threshold selection.
 *
 * Computes the threshold that maximizes between-class variance over a
 * grayscale histogram. This is the "auto-threshold" that adapts to each
 * image's lighting/contrast.
 *
 * Input: a grayscale buffer (each byte = one pixel intensity 0..255).
 * Output: the threshold value (0..255) that splits foreground from background.
 *
 * Why this exists: sharp doesn't ship Otsu, only a fixed-value `.threshold()`.
 * potrace has its own auto-threshold internally but it's a black box — we
 * can't get the value out to show the user or apply consistently across the
 * preview and the final extrude. Implementing it ourselves means both stages
 * use the EXACT same threshold value.
 */
export function computeOtsuThreshold(grayscaleBytes: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0)
  for (let i = 0; i < grayscaleBytes.length; i++) {
    histogram[grayscaleBytes[i]]++
  }
  const total = grayscaleBytes.length
  if (total === 0) return 128

  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i]

  let weightBg = 0
  let sumBg = 0
  let maxVariance = -1
  let bestThresholds: number[] = []

  for (let t = 0; t < 256; t++) {
    weightBg += histogram[t]
    if (weightBg === 0) continue
    const weightFg = total - weightBg
    if (weightFg === 0) break

    sumBg += t * histogram[t]
    const meanBg = sumBg / weightBg
    const meanFg = (sumAll - sumBg) / weightFg
    const between = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg)

    if (between > maxVariance + 1e-5) {
      maxVariance = between
      bestThresholds = [t]
    } else if (Math.abs(between - maxVariance) < 1e-5) {
      bestThresholds.push(t)
    }
  }

  if (bestThresholds.length === 0) return 128
  return bestThresholds[Math.floor(bestThresholds.length / 2)]
}
