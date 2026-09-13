import { describe, expect, it } from 'vitest'
import { AUTO, AutoCaptureGate, motion, sharpness, toGray, type FrameSignal } from './autocapture'

const SIDE = 32

function image(fn: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(SIDE * SIDE)
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) out[y * SIDE + x] = Math.max(0, Math.min(255, fn(x, y))) | 0
  return out
}

/** 3×3 box blur, edges clamped. */
function blur(src: Uint8Array): Uint8Array {
  return image((x, y) => {
    let s = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.max(0, Math.min(SIDE - 1, x + dx))
      const yy = Math.max(0, Math.min(SIDE - 1, y + dy))
      s += src[yy * SIDE + xx] ?? 0
    }
    return s / 9
  })
}

describe('sharpness', () => {
  it('is zero on a flat image and high on crisp edges', () => {
    expect(sharpness(image(() => 128), SIDE)).toBe(0)
    const stripes = image((x) => (Math.floor(x / 3) % 2 ? 40 : 220))
    expect(sharpness(stripes, SIDE)).toBeGreaterThan(20)
  })

  it('drops when the same image is blurred', () => {
    const stripes = image((x) => (Math.floor(x / 3) % 2 ? 40 : 220))
    expect(sharpness(blur(stripes), SIDE)).toBeLessThan(sharpness(stripes, SIDE) * 0.8)
  })

  it('is brightness independent', () => {
    const bright = image((x) => (Math.floor(x / 3) % 2 ? 100 : 220))
    const dim = image((x) => (Math.floor(x / 3) % 2 ? 50 : 110))
    const ratio = sharpness(dim, SIDE) / sharpness(bright, SIDE)
    expect(ratio).toBeGreaterThan(0.8)
    expect(ratio).toBeLessThan(1.25)
  })
})

describe('motion', () => {
  it('is zero for identical frames and large for a shifted scene', () => {
    const a = image((x) => (Math.floor(x / 4) % 2 ? 40 : 220))
    const b = image((x) => (Math.floor((x + 4) / 4) % 2 ? 40 : 220))
    expect(motion(a, a)).toBe(0)
    expect(motion(a, b)).toBeGreaterThan(AUTO.STILL_MOTION * 5)
  })

  it('treats sensor noise as still', () => {
    const a = image(() => 128)
    const b = image((x, y) => 128 + ((x * 7 + y * 13) % 5) - 2)
    expect(motion(a, b)).toBeLessThan(AUTO.STILL_MOTION)
  })
})

describe('toGray', () => {
  it('weights channels like luma', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    expect(Array.from(toGray(rgba, 4))).toEqual([76, 150, 29, 255])
  })
})

/** Feed the gate `n` samples 320 ms apart starting at `t`, all identical to `s`. Returns the last state. */
function run(gate: AutoCaptureGate, from: number, n: number, s: Omit<FrameSignal, 't'>) {
  let last = 'idle' as ReturnType<AutoCaptureGate['feed']>
  for (let i = 0; i < n; i++) last = gate.feed({ t: from + i * 320, ...s })
  return last
}
const READY = { level: 'good', sharp: 12, motion: 0.01 } as const

describe('AutoCaptureGate', () => {
  it('fires after the pill was placed, framed, still and sharp for HOLD_MS', () => {
    const g = new AutoCaptureGate()
    expect(g.feed({ t: 0, level: 'small', sharp: 5, motion: null })).toBe('framing')
    expect(g.feed({ t: 320, level: 'good', sharp: 12, motion: 0.2 })).toBe('moving')
    expect(g.feed({ t: 640, level: 'good', sharp: 12, motion: 0.01 })).toBe('focusing') // first steady sample: focus unknown
    expect(g.feed({ t: 960, ...READY })).toBe('holding')
    expect(g.feed({ t: 1280, ...READY })).toBe('holding')
    expect(g.feed({ t: 1600, ...READY })).toBe('shoot')
    expect(g.hasFired).toBe(true)
    expect(g.feed({ t: 1920, ...READY })).toBe('shoot') // latched until reset
  })

  it('does not re-shoot the side it just took: a perfectly framed, unchanged scene waits for ARM_TIMEOUT', () => {
    const g = new AutoCaptureGate()
    g.feed({ t: 0, ...READY, motion: null })
    expect(run(g, 320, 9, READY)).toBe('holding') // ~3.2 s in, nothing ever moved
    expect(run(g, 320 + 9 * 320, 6, READY)).toBe('shoot') // past ARM_TIMEOUT_MS + HOLD_MS
  })

  it('arms as soon as the scene changed, but never inside ARM_DELAY_MS', () => {
    const g = new AutoCaptureGate()
    g.feed({ t: 0, level: 'good', sharp: 12, motion: 0.3 }) // the flip
    expect(run(g, 100, 2, READY)).toBe('holding') // still inside the arm delay
    expect(run(g, 900, 3, READY)).toBe('shoot')
  })

  it('movement resets the hold countdown', () => {
    const g = new AutoCaptureGate()
    g.feed({ t: 0, level: 'small', sharp: 5, motion: null })
    run(g, 1000, 2, READY)
    expect(g.feed({ t: 1640, level: 'good', sharp: 12, motion: 0.1 })).toBe('moving')
    expect(g.feed({ t: 1960, ...READY })).toBe('holding')
    expect(g.feed({ t: 2280, ...READY })).toBe('holding')
    expect(g.feed({ t: 2600, ...READY })).toBe('shoot')
  })

  it('waits for focus: a frame much softer than the recent best is not ready', () => {
    const g = new AutoCaptureGate()
    g.feed({ t: 0, level: 'small', sharp: 5, motion: null })
    run(g, 1000, 2, READY)
    expect(g.feed({ t: 1640, level: 'good', sharp: 12 * 0.5, motion: 0.01 })).toBe('focusing')
    expect(g.feed({ t: 1960, level: 'good', sharp: 2, motion: 0.01 })).toBe('focusing') // below the absolute floor
  })

  it('losing the pill goes back to framing and a reset re-arms from scratch', () => {
    const g = new AutoCaptureGate()
    g.feed({ t: 0, level: 'small', sharp: 5, motion: null })
    run(g, 1000, 3, READY)
    expect(g.feed({ t: 2000, level: 'none', sharp: 1, motion: 0.01 })).toBe('framing')
    g.reset()
    expect(g.hasFired).toBe(false)
    expect(run(g, 5000, 3, READY)).toBe('holding') // not disturbed since reset, not timed out yet
  })
})
