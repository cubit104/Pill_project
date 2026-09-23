import { describe, expect, it } from 'vitest'
import { doseFromRate, rateFromDose, type InfusionInput } from './infusionMath'

const heparin: InfusionInput = { doseUnit: 'units/kg/h', weightKg: 80, bagAmount: 25_000, bagUnit: 'units', bagVolumeMl: 250 }
const norepinephrine: InfusionInput = { doseUnit: 'mcg/kg/min', weightKg: 80, bagAmount: 4, bagUnit: 'mg', bagVolumeMl: 250 }

function value(result: ReturnType<typeof rateFromDose>): number {
  if (!result.ok) throw new Error(result.message)
  return result.value
}

describe('infusion rate calculator (same arithmetic as the website)', () => {
  it('heparin 18 units/kg/h, 80 kg, 25,000 units in 250 mL runs at 14.4 mL/h', () => {
    const result = rateFromDose(18, heparin)
    expect(result).toMatchObject({ ok: true, text: '14.4 mL/h', formula: '18 units/kg/h × 80 kg ÷ 100 units/mL' })
  })

  it('norepinephrine 0.1 mcg/kg/min, 80 kg, 4 mg in 250 mL runs at 30 mL/h', () => {
    expect(rateFromDose(0.1, norepinephrine)).toMatchObject({ ok: true, text: '30.0 mL/h', formula: '0.1 mcg/kg/min × 80 kg × 60 min ÷ 16 mcg/mL' })
  })

  it('doses that are not per kg ignore the weight', () => {
    expect(value(rateFromDose(5, { doseUnit: 'mg/h', weightKg: 0, bagAmount: 125, bagUnit: 'mg', bagVolumeMl: 125 }))).toBe(5)
    expect(value(rateFromDose(100, { doseUnit: 'mg/h', weightKg: 0, bagAmount: 1, bagUnit: 'g', bagVolumeMl: 250 }))).toBe(25)
    expect(value(rateFromDose(1000, { ...heparin, doseUnit: 'units/h' }))).toBe(10)
  })

  it('reverse mode gives back the dose that produced the rate', () => {
    for (const [dose, input] of [[18, heparin], [0.1, norepinephrine], [0.05, { ...norepinephrine, doseUnit: 'mcg/min' as const }]] as const) {
      const back = doseFromRate(value(rateFromDose(dose, input)), input)
      expect(back.ok && Math.abs(back.value - dose) < 1e-9).toBe(true)
    }
    expect(doseFromRate(14.4, heparin)).toMatchObject({ ok: true, text: '18 units/kg/h', formula: '14.4 mL/h × 100 units/mL ÷ 80 kg' })
  })

  it('refuses instead of guessing: mixed unit kinds, missing weight, empty bag, zero dose', () => {
    expect(rateFromDose(18, { ...heparin, bagUnit: 'mg' })).toEqual({ ok: false, message: 'The dose is in units but the bag is in mg.' })
    expect(rateFromDose(18, { ...heparin, weightKg: 0 })).toEqual({ ok: false, message: 'Enter the patient weight.' })
    expect(rateFromDose(18, { ...heparin, bagVolumeMl: 0 })).toEqual({ ok: false, message: 'Enter what is in the bag.' })
    expect(rateFromDose(0, heparin)).toEqual({ ok: false, message: 'Enter the ordered dose.' })
    expect(doseFromRate(-1, heparin)).toEqual({ ok: false, message: 'Enter the pump rate.' })
  })
})
