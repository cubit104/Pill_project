'use client'

import { useState } from 'react'
import { BAG_UNITS, DOSE_UNITS, doseFromRate, rateFromDose, type BagUnit, type DoseUnit } from './infusionMath'

const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200'
const label = 'mb-1 mt-3 block text-xs font-semibold text-slate-600'

/**
 * Infusion rate calculator: ordered dose -> mL/h, or pump rate -> dose. Runs in the browser on what the nurse
 * types; nothing is prefilled from drug data and nothing is sent anywhere. The formula is always shown.
 */
export default function InfusionCalculator() {
  const [reverse, setReverse] = useState(false)
  const [dose, setDose] = useState('')
  const [rate, setRate] = useState('')
  const [doseUnit, setDoseUnit] = useState<DoseUnit>('mcg/kg/min')
  const [weight, setWeight] = useState('')
  const [bagAmount, setBagAmount] = useState('')
  const [bagUnit, setBagUnit] = useState<BagUnit>('mg')
  const [bagVolume, setBagVolume] = useState('')

  const input = { doseUnit, weightKg: Number(weight), bagAmount: Number(bagAmount), bagUnit, bagVolumeMl: Number(bagVolume) }
  const started = [reverse ? rate : dose, bagAmount, bagVolume].some((v) => v !== '')
  const result = reverse ? doseFromRate(Number(rate), input) : rateFromDose(Number(dose), input)
  const perKg = doseUnit.includes('/kg/')

  const tab = (active: boolean) =>
    `rounded-md px-2 py-2 text-[13px] font-semibold transition-colors ${active ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`

  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm" aria-labelledby="calc-heading">
      <h2 id="calc-heading" className="mb-3 border-l-4 border-emerald-500 pl-3 text-base font-semibold text-slate-800">
        Infusion rate calculator
      </h2>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="What to calculate">
        <button type="button" role="tab" aria-selected={!reverse} onClick={() => setReverse(false)} className={tab(!reverse)}>Dose → mL/h</button>
        <button type="button" role="tab" aria-selected={reverse} onClick={() => setReverse(true)} className={tab(reverse)}>mL/h → dose</button>
      </div>

      {reverse ? (
        <>
          <label className={label} htmlFor="calc-rate">Pump rate (mL/h)</label>
          <input id="calc-rate" className={field} type="number" inputMode="decimal" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
          <label className={label} htmlFor="calc-unit">Show the dose in</label>
          <select id="calc-unit" className={field} value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}>
            {DOSE_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </>
      ) : (
        <>
          <label className={label} htmlFor="calc-dose">Ordered dose</label>
          <div className="grid grid-cols-[1fr_8.5rem] gap-2">
            <input id="calc-dose" className={field} type="number" inputMode="decimal" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} />
            <select aria-label="Dose unit" className={field} value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}>
              {DOSE_UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
        </>
      )}

      {perKg && (
        <>
          <label className={label} htmlFor="calc-weight">Patient weight (kg)</label>
          <input id="calc-weight" className={field} type="number" inputMode="decimal" min="0" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </>
      )}

      <span className={label}>What is in the bag</span>
      <div className="grid grid-cols-[1fr_5.5rem_auto_1fr] items-center gap-1.5">
        <input aria-label="Drug amount in the bag" className={field} type="number" inputMode="decimal" min="0" step="any" value={bagAmount} onChange={(e) => setBagAmount(e.target.value)} />
        <select aria-label="Unit of the drug amount" className={field} value={bagUnit} onChange={(e) => setBagUnit(e.target.value as BagUnit)}>
          {BAG_UNITS.map((u) => <option key={u}>{u}</option>)}
        </select>
        <span className="px-0.5 text-xs text-slate-400">in</span>
        <input aria-label="Bag volume in mL" placeholder="mL" className={field} type="number" inputMode="decimal" min="0" step="any" value={bagVolume} onChange={(e) => setBagVolume(e.target.value)} />
      </div>

      <div aria-live="polite" className="mt-4">
        {!started ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">Type the order and what is in the bag.</p>
        ) : result.ok ? (
          <div className="rounded-xl bg-gradient-to-br from-emerald-700 to-emerald-900 px-4 py-3 text-white">
            <p className="text-3xl font-bold leading-tight tracking-tight">{result.text}</p>
            <p className="mt-0.5 text-xs text-emerald-100">{result.formula}</p>
          </div>
        ) : (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{result.message}</p>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Plain arithmetic on the numbers you type. Always verify with pharmacy and your pump&apos;s drug library.
      </p>
    </section>
  )
}
