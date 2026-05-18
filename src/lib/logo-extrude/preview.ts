/**
 * Fast preview: runs ONLY the sharp pipeline (crop + grayscale + polarity +
 * trim + threshold) and returns the PNG buffer that would be fed to potrace.
 *
 * Used by the Logo Studio UI to show the user what the binarization step
 * produces, so they can adjust crop/threshold/polarity before committing to
 * the full extrusion.
 */
import sharp from 'sharp'
import type { CropBox } from './extrude'
import { computeOtsuThreshold } from './otsu'

export interface LogoPreviewOptions {
  imageBuffer: Buffer
  cropBox?: CropBox
  /** Manual threshold (0..255). When omitted, sharp's normalise + a 128
   * threshold is used as a stand-in for Otsu — close enough for UI preview.
   * Note: the FINAL extrude uses potrace's true Otsu, so manual threshold here
   * is primarily for letting the user experiment. */
  threshold?: number
  /** Force polarity inversion regardless of mean-luminance auto-detect. */
  forceInvert?: boolean
  /** Skip trim when the user already cropped tight. */
  skipTrim?: boolean
}

export interface LogoPreviewResult {
  /** PNG of the final binarized image */
  pngBuffer: Buffer
  /** Dimensions after crop + trim */
  width: number
  height: number
  /** Whether polarity was inverted */
  inverted: boolean
  /** Threshold actually applied. -1 means auto (normalise-based). */
  thresholdApplied: number
}

export async function previewLogo(opts: LogoPreviewOptions): Promise<LogoPreviewResult> {
  const meta = await sharp(opts.imageBuffer).metadata()
  const fullWidth = meta.width ?? 0
  const fullHeight = meta.height ?? 0
  if (!fullWidth || !fullHeight) throw new Error('Could not read image dimensions')

  const rect = opts.cropBox
    ? {
        left: Math.max(0, Math.min(fullWidth - 1, Math.round(opts.cropBox.left))),
        top: Math.max(0, Math.min(fullHeight - 1, Math.round(opts.cropBox.top))),
        width: Math.max(1, Math.min(fullWidth, Math.round(opts.cropBox.width))),
        height: Math.max(1, Math.min(fullHeight, Math.round(opts.cropBox.height))),
      }
    : { left: 0, top: 0, width: fullWidth, height: fullHeight }

  let img = await sharp(opts.imageBuffer)
    .extract(rect)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .blur(0.8) // light blur — clean halos without erasing detail; matches extrudeLogo
    .toBuffer()

  // Polarity (same logic as extrude.ts)
  let inverted = false
  if (opts.forceInvert === true) {
    img = await sharp(img).negate({ alpha: false }).toBuffer()
    inverted = true
  } else if (opts.forceInvert === false) {
    // explicitly leave alone
  } else {
    const stats = await sharp(img).stats()
    const mean = stats.channels[0]?.mean ?? 127
    if (mean < 127) {
      img = await sharp(img).negate({ alpha: false }).toBuffer()
      inverted = true
    }
  }

  // Optional trim
  const skipTrim = opts.skipTrim ?? !!opts.cropBox
  if (!skipTrim) {
    try {
      img = await sharp(img).trim({ threshold: 15 }).toBuffer()
    } catch {
      /* keep untrimmed */
    }
  }

  // Threshold: explicit value or Otsu computed from this image's histogram.
  let appliedThreshold = opts.threshold
  if (appliedThreshold === undefined) {
    const rawBytes = await sharp(img).raw().toBuffer()
    appliedThreshold = computeOtsuThreshold(new Uint8Array(rawBytes))
  }
  img = await sharp(img).threshold(appliedThreshold).toBuffer()

  const outMeta = await sharp(img).metadata()
  return {
    pngBuffer: await sharp(img).png().toBuffer(),
    width: outMeta.width ?? 0,
    height: outMeta.height ?? 0,
    inverted,
    thresholdApplied: appliedThreshold,
  }
}
