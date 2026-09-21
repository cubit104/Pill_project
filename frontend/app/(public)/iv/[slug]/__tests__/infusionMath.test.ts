import test from 'node:test'
import assert from 'node:assert/strict'

import { doseFromRate, rateFromDose, type InfusionInput } from '../infusionMath.ts'

const heparin: InfusionInput = { doseUnit: 'units/kg/h', weightKg: 80, bagAmount: 25_000, bagUnit: 'units', bagVolumeMl: 250 }
const norepinephrine: InfusionInput = { doseUnit: 'mcg/kg/min', weightKg: 80, bagAmount: 4, bagUnit: 'mg', bagVolumeMl: 250 }

function value(result: ReturnType<typeof rateFromDose>): number {
  assert.ok(result.ok, result.ok ? '' : result.message)
  return result.value
}

test('heparin 18 units/kg/h, 80 kg, 25,000 units in 250 mL runs at 14.4 mL/h', () => {
  const result = rateFromDose(18, heparin)
  assert.ok(result.ok)
  assert.equal(result.text, '14.4 mL/h')
  assert.equal(result.formula, '18 units/kg/h × 80 kg ÷ 100 units/mL')
})

test('norepinephrine 0.1 mcg/kg/min, 80 kg, 4 mg in 250 mL runs at 30 mL/h (mg bag, mcg dose, per minute)', () => {
  const result = rateFromDose(0.1, norepinephrine)
  assert.ok(result.ok)
  assert.equal(result.text, '30.0 mL/h')
  assert.equal(result.formula, '0.1 mcg/kg/min × 80 kg × 60 min ÷ 16 mcg/mL')
})

test('doses that are not per kg ignore the weight', () => {
  const diltiazem: InfusionInput = { doseUnit: 'mg/h', weightKg: 0, bagAmount: 125, bagUnit: 'mg', bagVolumeMl: 125 }
  assert.equal(value(rateFromDose(5, diltiazem)), 5)
  const grams: InfusionInput = { doseUnit: 'mg/h', weightKg: 0, bagAmount: 1, bagUnit: 'g', bagVolumeMl: 250 }
  assert.equal(value(rateFromDose(100, grams)), 25) // 1 g in 250 mL = 4 mg/mL
  assert.equal(value(rateFromDose(1000, { ...heparin, doseUnit: 'units/h' })), 10)
})

test('reverse mode gives back the dose that produced the rate', () => {
  for (const [dose, input] of [[18, heparin], [0.1, norepinephrine], [0.05, { ...norepinephrine, doseUnit: 'mcg/min' as const }]] as const) {
    const back = doseFromRate(value(rateFromDose(dose, input)), input)
    assert.ok(back.ok)
    assert.ok(Math.abs(back.value - dose) < 1e-9)
  }
  const shown = doseFromRate(14.4, heparin)
  assert.ok(shown.ok)
  assert.equal(shown.text, '18 units/kg/h')
  assert.equal(shown.formula, '14.4 mL/h × 100 units/mL ÷ 80 kg')
})

test('refuses instead of guessing: mixed unit kinds, missing weight, empty bag, zero dose', () => {
  assert.deepEqual(rateFromDose(18, { ...heparin, bagUnit: 'mg' }), { ok: false, message: 'The dose is in units but the bag is in mg.' })
  assert.deepEqual(rateFromDose(5, { ...norepinephrine, bagUnit: 'units' }), { ok: false, message: 'The dose is in mcg but the bag is in units.' })
  assert.deepEqual(rateFromDose(18, { ...heparin, weightKg: 0 }), { ok: false, message: 'Enter the patient weight.' })
  assert.deepEqual(rateFromDose(18, { ...heparin, bagVolumeMl: 0 }), { ok: false, message: 'Enter what is in the bag.' })
  assert.deepEqual(rateFromDose(0, heparin), { ok: false, message: 'Enter the ordered dose.' })
  assert.deepEqual(rateFromDose(Number.NaN, heparin), { ok: false, message: 'Enter the ordered dose.' })
  assert.deepEqual(doseFromRate(-1, heparin), { ok: false, message: 'Enter the pump rate.' })
})
