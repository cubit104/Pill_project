import { useState } from 'react'
import Card, { SectionLabel } from './Card'
import { CalculatorIcon } from './IvIcons'
import { BAG_UNITS, DOSE_UNITS, doseFromRate, rateFromDose, type BagUnit, type DoseUnit } from '../lib/infusionMath'
import { useT } from '../lib/i18n'
import { hapticTick } from '../lib/native'

const FIELD = 'hairline w-full rounded-lg bg-surface px-3 py-2.5 text-[16px] text-ink'
const LABEL = 'mb-1 block text-[12px] font-semibold text-muted'

/**
 * Infusion rate calculator, the same arithmetic as the website's: the nurse types the order and what is in the
 * bag; nothing about the drug is assumed. Shown only on drugs that are given intravenously.
 */
export default function InfusionCalculator() {
  const t = useT()
  const [reverse, setReverse] = useState(false)
  const [dose, setDose] = useState('')
  const [rate, setRate] = useState('')
  const [doseUnit, setDoseUnit] = useState<DoseUnit>('mcg/kg/min')
  const [weight, setWeight] = useState('')
  const [bagAmount, setBagAmount] = useState('')
  const [bagUnit, setBagUnit] = useState<BagUnit>('mg')
  const [bagVolume, setBagVolume] = useState('')

  const input = { doseUnit, weightKg: Number(weight), bagAmount: Number(bagAmount), bagUnit, bagVolumeMl: Number(bagVolume) }
  const perKg = doseUnit.includes('/kg/')
  const touched = reverse ? rate !== '' : dose !== ''
  const result = touched ? (reverse ? doseFromRate(Number(rate), input) : rateFromDose(Number(dose), input)) : null

  const modeButton = (value: boolean, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={reverse === value}
      onClick={() => {
        void hapticTick()
        setReverse(value)
      }}
      className={`min-h-[40px] flex-1 rounded-lg text-[14px] font-semibold ${reverse === value ? 'bg-brand text-brand-fg' : 'text-body'}`}
    >
      {label}
    </button>
  )

  return (
    <section>
      <SectionLabel>{t('Infusion rate calculator')}</SectionLabel>
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <CalculatorIcon size={16} className="flex-none" />
          {t('Enter the order and what is in the bag. Nothing here comes from the label.')}
        </div>
        <div className="flex gap-1 rounded-xl bg-brand-tint p-1" role="tablist" aria-label={t('What to calculate')}>
          {modeButton(false, t('Dose → mL/h'))}
          {modeButton(true, t('mL/h → dose'))}
        </div>

        {reverse ? (
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={LABEL}>{t('Pump rate (mL/h)')}</span>
              <input className={FIELD} type="number" inputMode="decimal" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <label>
              <span className={LABEL}>{t('Show the dose in')}</span>
              <select className={FIELD} value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}>
                {DOSE_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={LABEL}>{t('Ordered dose')}</span>
              <input className={FIELD} type="number" inputMode="decimal" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} />
            </label>
            <label>
              <span className={LABEL}>{t('Dose unit')}</span>
              <select className={FIELD} value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}>
                {DOSE_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {perKg && (
          <label className="block">
            <span className={LABEL}>{t('Patient weight (kg)')}</span>
            <input className={FIELD} type="number" inputMode="decimal" min="0" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </label>
        )}

        <div>
          <span className={LABEL}>{t('In the bag')}</span>
          <div className="grid grid-cols-[1fr_5.5rem_1fr] gap-2">
            <input aria-label={t('Drug amount in the bag')} className={FIELD} type="number" inputMode="decimal" min="0" step="any" value={bagAmount} onChange={(e) => setBagAmount(e.target.value)} />
            <select aria-label={t('Unit of the drug amount')} className={FIELD} value={bagUnit} onChange={(e) => setBagUnit(e.target.value as BagUnit)}>
              {BAG_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <input aria-label={t('Bag volume in mL')} placeholder="mL" className={FIELD} type="number" inputMode="decimal" min="0" step="any" value={bagVolume} onChange={(e) => setBagVolume(e.target.value)} />
          </div>
        </div>

        {result && (
          <div className={`rounded-xl px-4 py-3 ${result.ok ? 'bg-brand-tint' : 'bg-[var(--warn-tint,transparent)] hairline'}`} aria-live="polite">
            {result.ok ? (
              <>
                <p className="text-[24px] font-bold tracking-tight text-ink">{result.text}</p>
                <p className="mt-0.5 text-[13px] text-muted">{result.formula}</p>
              </>
            ) : (
              <p className="text-[14px] text-body">{t(result.message)}</p>
            )}
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-muted">{t('Check every rate against the order and your pump before starting. This is arithmetic, not clinical advice.')}</p>
      </Card>
    </section>
  )
}
