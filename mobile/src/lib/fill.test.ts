import { describe, expect, it } from 'vitest'
import { estimateFill, fillHint } from './fill'

const SIZE = 64

/** Square RGBA image: flat background with an optional centred ellipse "pill". */
function synth(opts: { bg: [number, number, number]; pill?: { rx: number; ry: number; color: [number, number, number] }; noise?: number }): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff) * 2 - 1
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      let [r, g, b] = opts.bg
      if (opts.pill) {
        const dx = (x + 0.5 - SIZE / 2) / (opts.pill.rx * SIZE)
        const dy = (y + 0.5 - SIZE / 2) / (opts.pill.ry * SIZE)
        if (dx * dx + dy * dy <= 1) [r, g, b] = opts.pill.color
      }
      const n = opts.noise ?? 0
      data[i] = Math.max(0, Math.min(255, r + rnd() * n))
      data[i + 1] = Math.max(0, Math.min(255, g + rnd() * n))
      data[i + 2] = Math.max(0, Math.min(255, b + rnd() * n))
      data[i + 3] = 255
    }
  }
  return data
}

describe('estimateFill', () => {
  it('sees nothing on a plain background', () => {
    const e = estimateFill(synth({ bg: [200, 200, 200], noise: 6 }), SIZE)
    expect(e.level).toBe('none')
    expect(e.extent).toBe(0)
  })

  it('flags a small pill', () => {
    // Pill diameter = 0.3 of the square (rx 0.15), well under GOOD_EXTENT.
    const e = estimateFill(synth({ bg: [210, 205, 200], pill: { rx: 0.15, ry: 0.12, color: [240, 240, 240] }, noise: 5 }), SIZE)
    expect(e.level).toBe('small')
    expect(e.extent).toBeGreaterThan(0.2)
    expect(e.extent).toBeLessThan(0.45)
  })

  it('is good when the pill fills most of the circle', () => {
    const e = estimateFill(synth({ bg: [90, 80, 70], pill: { rx: 0.4, ry: 0.28, color: [230, 225, 220] }, noise: 5 }), SIZE)
    expect(e.level).toBe('good')
    expect(e.extent).toBeGreaterThan(0.6)
  })

  it('handles a white pill on a light table', () => {
    const e = estimateFill(synth({ bg: [196, 196, 190], pill: { rx: 0.38, ry: 0.38, color: [250, 250, 250] }, noise: 4 }), SIZE)
    expect(e.level).toBe('good')
  })

  it('does not mistake sensor noise for a pill', () => {
    const e = estimateFill(synth({ bg: [120, 120, 120], noise: 14 }), SIZE)
    expect(e.level).toBe('none')
  })
})

describe('fillHint', () => {
  it('coaches by level', () => {
    expect(fillHint(null)).toMatch(/Fit the pill/)
    expect(fillHint('small')).toMatch(/Move closer/)
    expect(fillHint('good')).toMatch(/Hold still/)
  })
})
