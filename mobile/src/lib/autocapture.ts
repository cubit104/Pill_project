/**
 * Auto-capture: decide, from a stream of cheap preview samples, when the pill
 * photo should take itself. Pure maths and a small state machine, no camera or
 * DOM here, so every rule is unit-tested.
 *
 * A frame is "ready" when the pill fills the circle (fill coaching), the scene
 * is still (little change since the previous sample) and the image is sharp
 * (Laplacian energy near the best seen recently, so we wait for autofocus to
 * settle instead of grabbing the first frame). Ready must hold for HOLD_MS.
 *
 * The gate also refuses to fire until the scene has visibly changed since the
 * camera opened (or a few seconds passed): side 2 opens right after side 1 with
 * the same pill still perfectly framed, and we must not shoot it again before
 * the user has flipped it.
 */
import type { FillLevel } from './fill'

export interface FrameSignal {
  /** Sample time in ms (any monotonic clock). */
  t: number
  level: FillLevel | null
  /** Brightness-normalised Laplacian energy inside the circle; higher is sharper. */
  sharp: number
  /** Mean absolute change vs the previous sample, 0–1; null when there is no previous sample. */
  motion: number | null
}

export type AutoState =
  | 'idle' // nothing sampled yet
  | 'framing' // pill not filling the circle: the fill hint applies
  | 'moving' // framed but the scene is moving
  | 'focusing' // framed and still, waiting for the image to be sharp
  | 'holding' // everything good, counting down HOLD_MS
  | 'shoot' // take the photo now (returned once, then latched)

export const AUTO = {
  /** Never fire in the first moments after the camera opens or resets. */
  ARM_DELAY_MS: 800,
  /** Fire eventually even if the scene never changed (user was already perfectly framed). */
  ARM_TIMEOUT_MS: 4000,
  /** Mean absolute frame difference (0–1) at or below which the scene counts as still. */
  STILL_MOTION: 0.045,
  /** Absolute sharpness floor: below this nothing is ever readable. */
  SHARP_FLOOR: 3,
  /** ...and at least this fraction of the best sharpness seen recently (autofocus settled). */
  SHARP_RATIO: 0.75,
  /** How far back "recently" reaches for the sharpness reference. */
  SHARP_WINDOW_MS: 2500,
  /** Fewer sharp samples than this and we cannot tell whether focus has settled. */
  SHARP_MIN_SAMPLES: 2,
  /** Ready must hold this long before the shutter fires. */
  HOLD_MS: 500,
} as const

/**
 * Sharpness of a square grayscale image: RMS of the 4-neighbour Laplacian over
 * the inscribed circle (radius 0.9, so the ring edge never counts), divided by
 * mean brightness so a dim scene is not mistaken for a soft one.
 */
export function sharpness(gray: ArrayLike<number>, side: number): number {
  if (side < 3) return 0
  const r = side / 2
  const limit = (0.9 * r) ** 2
  let energy = 0
  let sum = 0
  let n = 0
  for (let y = 1; y < side - 1; y++) {
    const dy = y + 0.5 - r
    for (let x = 1; x < side - 1; x++) {
      const dx = x + 0.5 - r
      if (dx * dx + dy * dy > limit) continue
      const i = y * side + x
      const c = gray[i] ?? 0
      const lap = 4 * c - (gray[i - 1] ?? 0) - (gray[i + 1] ?? 0) - (gray[i - side] ?? 0) - (gray[i + side] ?? 0)
      energy += lap * lap
      sum += c
      n++
    }
  }
  if (n === 0) return 0
  return (Math.sqrt(energy / n) / (sum / n + 8)) * 100
}

/** Mean absolute difference between two same-sized grayscale images, 0–1. */
export function motion(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
  return sum / n / 255
}

/** RGBA bytes → 8-bit luma. */
export function toGray(data: Uint8ClampedArray, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels)
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    out[p] = Math.round(0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0))
  }
  return out
}

export class AutoCaptureGate {
  private t0: number | null = null
  private disturbed = false
  private holdSince: number | null = null
  private sharpHistory: { t: number; v: number }[] = []
  private fired = false

  /** Forget everything: used when the side changes or a capture failed. */
  reset(): void {
    this.t0 = null
    this.disturbed = false
    this.holdSince = null
    this.sharpHistory = []
    this.fired = false
  }

  get hasFired(): boolean {
    return this.fired
  }

  feed(s: FrameSignal): AutoState {
    if (this.fired) return 'shoot'
    if (this.t0 === null) this.t0 = s.t
    const good = s.level === 'good'
    const known = s.motion !== null
    const moving = known && (s.motion as number) > AUTO.STILL_MOTION
    const still = known && !moving
    // The scene changed since we opened: a fresh placement, not the side we just shot.
    if (!good || moving) this.disturbed = true

    // Focus reference: only steady, framed frames count (motion blur would only lower the bar).
    if (good && still) {
      this.sharpHistory.push({ t: s.t, v: s.sharp })
      this.sharpHistory = this.sharpHistory.filter((h) => s.t - h.t <= AUTO.SHARP_WINDOW_MS)
    }

    if (!good) {
      this.holdSince = null
      return 'framing'
    }
    if (!still) {
      this.holdSince = null
      return 'moving'
    }
    const best = this.sharpHistory.reduce((m, h) => Math.max(m, h.v), 0)
    const settled = this.sharpHistory.length >= AUTO.SHARP_MIN_SAMPLES
    const sharpOk = settled && s.sharp >= AUTO.SHARP_FLOOR && s.sharp >= AUTO.SHARP_RATIO * best
    if (!sharpOk) {
      this.holdSince = null
      return 'focusing'
    }
    const age = s.t - this.t0
    const armed = age >= AUTO.ARM_DELAY_MS && (this.disturbed || age >= AUTO.ARM_TIMEOUT_MS)
    if (!armed) return 'holding'
    if (this.holdSince === null) this.holdSince = s.t
    if (s.t - this.holdSince >= AUTO.HOLD_MS) {
      this.fired = true
      return 'shoot'
    }
    return 'holding'
  }
}
