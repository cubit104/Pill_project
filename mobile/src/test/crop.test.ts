import { describe, expect, it } from 'vitest'
import { computeCoverCrop, CROP_PAD, downscaleFactor, GUIDE_FRACTION, guideDiameter, MAX_SIDE } from '../lib/crop'

describe('guideDiameter', () => {
  it('is 68% of the shorter preview side', () => {
    expect(guideDiameter(390, 700)).toBeCloseTo(0.68 * 390)
    expect(guideDiameter(800, 400)).toBeCloseTo(0.68 * 400)
    expect(GUIDE_FRACTION).toBe(0.68)
  })
})

describe('computeCoverCrop', () => {
  it('maps the guide circle through the object-fit: cover scale', () => {
    // Portrait preview 390x700, portrait frame 3024x4032 (already rotated to match).
    const guidePx = guideDiameter(390, 700)
    const crop = computeCoverCrop({ natW: 3024, natH: 4032, dispW: 390, dispH: 700, guidePx })
    const scale = Math.max(390 / 3024, 700 / 4032)
    const expectedSide = (guidePx / scale) * (1 + 2 * CROP_PAD)
    expect(crop.side).toBeCloseTo(expectedSide, 5)
    // Centred
    expect(crop.sx).toBeCloseTo(3024 / 2 - expectedSide / 2, 5)
    expect(crop.sy).toBeCloseTo(4032 / 2 - expectedSide / 2, 5)
    // Capped output
    expect(crop.outSide).toBe(Math.min(MAX_SIDE, Math.round(expectedSide)))
  })

  it('never exceeds the frame and clamps to the origin', () => {
    const crop = computeCoverCrop({ natW: 640, natH: 480, dispW: 390, dispH: 700, guidePx: 2000 })
    expect(crop.side).toBeLessThanOrEqual(480)
    expect(crop.sx).toBeGreaterThanOrEqual(0)
    expect(crop.sy).toBeGreaterThanOrEqual(0)
    expect(crop.sx + crop.side).toBeLessThanOrEqual(640)
    expect(crop.sy + crop.side).toBeLessThanOrEqual(480)
  })

  it('handles a landscape sensor frame behind a portrait preview (rotation invariance)', () => {
    const guidePx = guideDiameter(390, 700)
    const portrait = computeCoverCrop({ natW: 3024, natH: 4032, dispW: 390, dispH: 700, guidePx })
    const landscape = computeCoverCrop({ natW: 4032, natH: 3024, dispW: 390, dispH: 700, guidePx })
    // Same crop side either way, since a centred square is rotation-invariant.
    expect(landscape.side).toBeCloseTo(portrait.side, 5)
    expect(landscape.sx).toBeCloseTo(4032 / 2 - landscape.side / 2, 5)
    expect(landscape.sy).toBeCloseTo(3024 / 2 - landscape.side / 2, 5)
  })

  it('applies digital zoom by tightening the crop', () => {
    const guidePx = guideDiameter(390, 700)
    const z1 = computeCoverCrop({ natW: 3024, natH: 4032, dispW: 390, dispH: 700, guidePx, zoom: 1 })
    const z2 = computeCoverCrop({ natW: 3024, natH: 4032, dispW: 390, dispH: 700, guidePx, zoom: 2 })
    expect(z2.side).toBeCloseTo(z1.side / 2, 5)
  })

  it('rejects unusable inputs', () => {
    expect(() => computeCoverCrop({ natW: 0, natH: 100, dispW: 10, dispH: 10, guidePx: 5 })).toThrow()
    expect(() => computeCoverCrop({ natW: 100, natH: 100, dispW: 10, dispH: 10, guidePx: 0 })).toThrow()
  })
})

describe('downscaleFactor', () => {
  it('never upscales and caps the longest side', () => {
    expect(downscaleFactor(800, 600)).toBe(1)
    expect(downscaleFactor(4000, 3000)).toBeCloseTo(0.4)
    expect(downscaleFactor(3000, 4000) * 4000).toBeCloseTo(MAX_SIDE)
  })
})
