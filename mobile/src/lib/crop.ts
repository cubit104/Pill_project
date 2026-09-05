/**
 * Pure crop math for the circle-guide capture. Mirrors the web
 * CameraCapture.tsx: the camera frame is aspect-filled ("object-fit: cover")
 * into the preview rect, the guide circle is GUIDE_FRACTION of the shorter
 * preview side, and we save the circle plus CROP_PAD margin, capped at
 * MAX_SIDE px.
 */

export const GUIDE_FRACTION = 0.68
export const CROP_PAD = 0.12
export const MAX_SIDE = 1600
export const JPEG_QUALITY = 0.9

export interface CropInput {
  /** Native frame size (pixels) as decoded. */
  natW: number
  natH: number
  /** Preview rect size (CSS pixels) the frame was aspect-filled into. */
  dispW: number
  dispH: number
  /** Guide circle diameter in the same CSS pixels as dispW/dispH. */
  guidePx: number
  /** Digital zoom applied to the preview (1 when the camera zooms optically). */
  zoom?: number
}

export interface CropRect {
  sx: number
  sy: number
  side: number
  /** Output side after the MAX_SIDE cap. */
  outSide: number
}

/** Guide circle diameter for a preview box. */
export function guideDiameter(dispW: number, dispH: number, fraction = GUIDE_FRACTION): number {
  return fraction * Math.min(dispW, dispH)
}

/**
 * Compute the source square (in native frame pixels) that corresponds to the
 * guide circle (+ padding) on screen.
 *
 * The native frame may come back rotated relative to the preview (e.g. a
 * landscape sensor frame behind a portrait preview). A centred square is
 * rotation-invariant, so we only need the cover scale to be computed with the
 * frame in the same orientation as the preview: when orientations disagree we
 * swap the frame dimensions for the scale computation.
 */
export function computeCoverCrop(input: CropInput): CropRect {
  const { natW, natH, dispW, dispH, guidePx } = input
  const zoom = input.zoom ?? 1
  if (!(natW > 0 && natH > 0 && dispW > 0 && dispH > 0 && guidePx > 0)) {
    throw new Error('Camera frame not ready')
  }
  const frameLandscape = natW > natH
  const previewLandscape = dispW > dispH
  const mismatch = frameLandscape !== previewLandscape && natW !== natH && dispW !== dispH
  const fw = mismatch ? natH : natW
  const fh = mismatch ? natW : natH

  const scale = Math.max(dispW / fw, dispH / fh) * zoom
  const side = Math.min(natW, natH, (guidePx / scale) * (1 + 2 * CROP_PAD))
  const sx = Math.max(0, natW / 2 - side / 2)
  const sy = Math.max(0, natH / 2 - side / 2)
  const outSide = Math.max(1, Math.min(MAX_SIDE, Math.round(side)))
  return { sx, sy, side, outSide }
}

/** Scale factor so that max(w, h) <= maxSide (never upscales). */
export function downscaleFactor(w: number, h: number, maxSide = MAX_SIDE): number {
  const longest = Math.max(w, h)
  return longest > maxSide ? maxSide / longest : 1
}
