/**
 * "Fill the circle" coaching: from a small square sample of the guide-circle
 * region, estimate how much of the circle the pill covers. Pure pixel math so
 * it can be unit-tested; no camera or DOM here.
 *
 * Method: the ring just inside the circle edge is assumed to be background
 * (table / hand). Pixels that differ from that background colour by more than
 * an adaptive threshold are "pill". The pill's extent is the 5th–95th
 * percentile bounding box of those pixels, relative to the circle diameter.
 */

export type FillLevel = 'none' | 'small' | 'good'

export interface FillEstimate {
  /** Longest side of the pill's bounding box over the circle diameter, 0–1. */
  extent: number
  /** Fraction of circle pixels classified as pill, 0–1. */
  area: number
  level: FillLevel
}

/** Below this the pill is too small to read reliably; at/above it the ring turns green. */
export const GOOD_EXTENT = 0.55
/** Below this we assume there is no pill in the circle yet (or it is unreadably tiny). */
export const MIN_EXTENT = 0.18
const MIN_THRESHOLD = 34

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] ?? 0
}

/**
 * @param data RGBA bytes of a square image whose inscribed circle is the guide circle.
 * @param size Width (= height) of that square in pixels.
 */
export function estimateFill(data: Uint8ClampedArray, size: number): FillEstimate {
  const r = size / 2
  const cx = r
  const cy = r
  const bgR: number[] = []
  const bgG: number[] = []
  const bgB: number[] = []
  // 1. Background reference: the ring between 0.86 r and 0.98 r.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
      if (d < 0.86 || d > 0.98) continue
      const i = (y * size + x) * 4
      bgR.push(data[i] ?? 0)
      bgG.push(data[i + 1] ?? 0)
      bgB.push(data[i + 2] ?? 0)
    }
  }
  const mR = median(bgR)
  const mG = median(bgG)
  const mB = median(bgB)
  // Adaptive threshold: 2.5 × the background's own spread, floored so noise never counts as pill.
  const spread = median(bgR.map((v, i) => Math.hypot(v - mR, (bgG[i] ?? 0) - mG, (bgB[i] ?? 0) - mB)))
  const threshold = Math.max(MIN_THRESHOLD, spread * 2.5)

  // 2. Classify pixels inside 0.9 r; collect coordinates of "pill" pixels.
  const xs: number[] = []
  const ys: number[] = []
  let inside = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
      if (d > 0.9) continue
      inside++
      const i = (y * size + x) * 4
      const diff = Math.hypot((data[i] ?? 0) - mR, (data[i + 1] ?? 0) - mG, (data[i + 2] ?? 0) - mB)
      if (diff > threshold) {
        xs.push(x)
        ys.push(y)
      }
    }
  }
  const area = inside ? xs.length / inside : 0
  if (xs.length < inside * 0.01) return { extent: 0, area, level: 'none' }
  // 3. Robust bounding box → extent relative to the circle diameter.
  const w = percentile(xs, 0.95) - percentile(xs, 0.05) + 1
  const h = percentile(ys, 0.95) - percentile(ys, 0.05) + 1
  const extent = Math.min(1, Math.max(w, h) / size)
  const level: FillLevel = extent >= GOOD_EXTENT ? 'good' : extent >= MIN_EXTENT ? 'small' : 'none'
  return { extent, area, level }
}

/** Hint text for the camera overlay. */
export function fillHint(level: FillLevel | null): string {
  if (level === 'good') return 'Good. Hold still and tap the shutter.'
  if (level === 'small') return 'Move closer or pinch to zoom until the pill fills the circle.'
  return 'Fit the pill in the circle. Pinch to zoom.'
}
