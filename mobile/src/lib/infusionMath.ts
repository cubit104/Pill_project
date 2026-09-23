/**
 * Arithmetic behind the infusion rate calculator, the same as the website's (frontend/app/(public)/iv/[slug]/
 * infusionMath.ts). No drug data in here on purpose: the nurse types the order and what is in the bag, this only
 * divides and multiplies, and shows how it got there.
 */

export const DOSE_UNITS = ['units/kg/h', 'units/h', 'mcg/kg/min', 'mcg/min', 'mg/kg/h', 'mg/h'] as const
export const BAG_UNITS = ['units', 'mg', 'mcg', 'g'] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]
export type BagUnit = (typeof BAG_UNITS)[number]

export interface InfusionInput {
  doseUnit: DoseUnit
  /** Only used when the dose is per kg. */
  weightKg: number
  bagAmount: number
  bagUnit: BagUnit
  bagVolumeMl: number
}

export type InfusionResult = { ok: true; value: number; text: string; formula: string } | { ok: false; message: string }

const MCG_PER: Record<Exclude<BagUnit, 'units'>, number> = { mcg: 1, mg: 1_000, g: 1_000_000 }

function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)))
}

/** Shared set-up: concentration in the dose's own unit per mL, and the dose-per-hour multiplier. */
function prepare(input: InfusionInput) {
  const [amountUnit, second, third] = input.doseUnit.split('/')
  const perKg = second === 'kg'
  const perMinute = (perKg ? third : second) === 'min'
  const doseIsUnits = amountUnit === 'units'
  if (doseIsUnits !== (input.bagUnit === 'units')) {
    return { ok: false as const, error: `The dose is in ${amountUnit} but the bag is in ${input.bagUnit}.` }
  }
  if (!(input.bagAmount > 0) || !(input.bagVolumeMl > 0)) return { ok: false as const, error: 'Enter what is in the bag.' }
  if (perKg && !(input.weightKg > 0)) return { ok: false as const, error: 'Enter the patient weight.' }
  const bagInDoseUnit = doseIsUnits
    ? input.bagAmount
    : (input.bagAmount * MCG_PER[input.bagUnit as Exclude<BagUnit, 'units'>]) / MCG_PER[amountUnit as Exclude<BagUnit, 'units'>]
  return {
    ok: true as const,
    amountUnit,
    perKg,
    perMinute,
    concentration: bagInDoseUnit / input.bagVolumeMl,
    perHour: (perKg ? input.weightKg : 1) * (perMinute ? 60 : 1),
  }
}

/** Ordered dose -> pump rate in mL/h. */
export function rateFromDose(dose: number, input: InfusionInput): InfusionResult {
  const p = prepare(input)
  if (!p.ok) return { ok: false, message: p.error }
  if (!(dose > 0)) return { ok: false, message: 'Enter the ordered dose.' }
  const value = (dose * p.perHour) / p.concentration
  if (!Number.isFinite(value)) return { ok: false, message: 'Check the numbers.' }
  const formula =
    `${trim(dose, 4)} ${input.doseUnit}` +
    (p.perKg ? ` × ${trim(input.weightKg, 2)} kg` : '') +
    (p.perMinute ? ' × 60 min' : '') +
    ` ÷ ${trim(p.concentration, 4)} ${p.amountUnit}/mL`
  return { ok: true, value, text: `${value.toFixed(1)} mL/h`, formula }
}

/** Pump rate in mL/h -> the dose the patient is getting. */
export function doseFromRate(rateMlH: number, input: InfusionInput): InfusionResult {
  const p = prepare(input)
  if (!p.ok) return { ok: false, message: p.error }
  if (!(rateMlH > 0)) return { ok: false, message: 'Enter the pump rate.' }
  const value = (rateMlH * p.concentration) / p.perHour
  if (!Number.isFinite(value)) return { ok: false, message: 'Check the numbers.' }
  const formula =
    `${trim(rateMlH, 2)} mL/h × ${trim(p.concentration, 4)} ${p.amountUnit}/mL` +
    (p.perKg ? ` ÷ ${trim(input.weightKg, 2)} kg` : '') +
    (p.perMinute ? ' ÷ 60 min' : '')
  return { ok: true, value, text: `${trim(value, 3)} ${input.doseUnit}`, formula }
}
