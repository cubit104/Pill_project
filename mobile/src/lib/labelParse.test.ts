import { describe, expect, it } from 'vitest'
import { drugNameCandidates, expandShorthand, parseLabel, scheduleFromSig } from './labelParse'

const CVS = [
  'CVS pharmacy',
  '1234 MAIN ST, AUSTIN TX 78701',
  '(512) 555-0142',
  'RX# 0987654-01',
  'DR. JANE SMITH',
  'JOHN Q PATIENT',
  'ATORVASTATIN CALCIUM 20 MG TABLET',
  'GENERIC FOR: LIPITOR',
  'TAKE 1 TABLET BY MOUTH ONCE DAILY',
  'AT BEDTIME',
  'QTY: 90   REFILLS: 3',
  'FILLED: 09/02/2026   DISCARD AFTER: 09/02/2027',
  'MFR: GREENSTONE',
]

const WALGREENS = [
  'Walgreens Pharmacy #04521',
  '800 CONGRESS AVE  AUSTIN, TX',
  'Phone: 512-555-0199',
  'Rx 4419920',
  'LISINOPRIL',
  '10MG TAB',
  'Take one (1) tablet by mouth twice daily',
  'Qty 60  No refills',
  'Date filled 08/30/26',
  'Prescriber: A PATEL MD',
]

describe('parseLabel', () => {
  it('reads a CVS style label', () => {
    const p = parseLabel(CVS)
    expect(p.drugName).toBe('Atorvastatin Calcium')
    expect(p.strength).toBe('20 MG')
    expect(p.form).toBe('tablet')
    expect(p.directions).toBe('TAKE 1 TABLET BY MOUTH ONCE DAILY AT BEDTIME')
    expect(p.quantity).toBe(90)
    expect(p.refills).toBe(3)
    expect(p.rxNumber).toBe('0987654-01')
    expect(p.fillDate).toBe('09/02/2026')
    expect(p.pharmacyName).toBe('CVS')
    expect(p.pharmacyPhone).toBe('512-555-0142')
    expect(p.prescriber).toBe('Jane Smith')
  })

  it('reads a Walgreens style label with the name on its own line', () => {
    const p = parseLabel(WALGREENS)
    expect(p.drugName).toBe('Lisinopril')
    expect(p.strength).toBe('10 MG')
    expect(p.form).toBe('tablet')
    expect(p.directions).toBe('Take one (1) tablet by mouth twice daily')
    expect(p.quantity).toBe(60)
    expect(p.refills).toBe(0)
    expect(p.rxNumber).toBe('4419920')
    expect(p.fillDate).toBe('08/30/26')
    expect(p.pharmacyName).toBe('Walgreens')
    expect(p.pharmacyPhone).toBe('512-555-0199')
    expect(p.prescriber).toBe('A Patel')
  })

  it('keeps reading order from y and survives missing fields', () => {
    const p = parseLabel([
      { text: 'TAKE 2 CAPSULES EVERY 8 HOURS', y: 0.6 },
      { text: 'AMOXICILLIN 500 MG CAPSULE', y: 0.4 },
      { text: 'Corner Drug Pharmacy', y: 0.1 },
    ])
    expect(p.drugName).toBe('Amoxicillin')
    expect(p.strength).toBe('500 MG')
    expect(p.form).toBe('capsule')
    expect(p.directions).toBe('TAKE 2 CAPSULES EVERY 8 HOURS')
    expect(p.pharmacyName).toBe('Corner Drug Pharmacy')
    expect(p.quantity).toBeNull()
    expect(p.rxNumber).toBeNull()
  })
})

describe('scheduleFromSig', () => {
  it('once daily at bedtime', () => {
    const s = scheduleFromSig('TAKE 1 TABLET BY MOUTH ONCE DAILY AT BEDTIME')
    expect(s).toEqual({ times: ['22:00'], days: [0, 1, 2, 3, 4, 5, 6], dose: '1 tablet', pillsPerDay: 1, asNeeded: false })
  })

  it('twice daily with a spelled-out count', () => {
    const s = scheduleFromSig('Take one (1) tablet by mouth twice daily')
    expect(s?.times).toEqual(['08:00', '20:00'])
    expect(s?.dose).toBe('1 tablet')
    expect(s?.pillsPerDay).toBe(2)
  })

  it('every 8 hours', () => {
    const s = scheduleFromSig('TAKE 2 CAPSULES EVERY 8 HOURS')
    expect(s?.times).toEqual(['08:00', '14:00', '20:00'])
    expect(s?.dose).toBe('2 capsules')
    expect(s?.pillsPerDay).toBe(6)
  })

  it('half tablet in the morning and evening', () => {
    const s = scheduleFromSig('Take 1/2 tablet in the morning and 1/2 tablet in the evening')
    expect(s?.times).toEqual(['08:00', '18:00'])
    expect(s?.dose).toBe('1/2 tablet')
    expect(s?.pillsPerDay).toBe(1)
  })

  it('as needed has no times', () => {
    const s = scheduleFromSig('TAKE 1 TABLET EVERY 6 HOURS AS NEEDED FOR PAIN')
    expect(s?.asNeeded).toBe(true)
  })

  it('weekly on a named day', () => {
    const s = scheduleFromSig('TAKE 1 TABLET BY MOUTH EVERY MONDAY')
    expect(s?.days).toEqual([1])
    expect(s?.times).toEqual(['08:00'])
  })

  it('returns null for nothing usable', () => {
    expect(scheduleFromSig(null)).toBeNull()
    expect(scheduleFromSig('SHAKE WELL')).toBeNull()
  })
})

describe('pharmacy shorthand', () => {
  it('expands common label abbreviations', () => {
    expect(expandShorthand('AMOX/K CLAV')).toBe('amoxicillin clavulanate')
    expect(expandShorthand('HYDROCO/APAP')).toBe('hydrocodone acetaminophen')
    expect(expandShorthand('SMZ/TMP DS')).toBe('sulfamethoxazole trimethoprim DS')
    expect(expandShorthand('METOP SUCC ER')).toBe('metoprolol SUCC')
    expect(expandShorthand('Lisinopril')).toBe('Lisinopril')
  })

  it('offers lookup candidates from broad to narrow', () => {
    expect(drugNameCandidates('Amox/k Clav')).toEqual(['Amox/k Clav', 'amoxicillin clavulanate', 'amoxicillin', 'clavulanate'])
    expect(drugNameCandidates(null)).toEqual([])
  })

  it('reads combo strengths', () => {
    const p = parseLabel(['AMOX/K CLAV 875-125 MG TAB', 'TAKE 1 TABLET BY MOUTH TWICE DAILY'])
    expect(p.drugName).toBe('Amox/k Clav')
    expect(p.strength).toBe('875-125 MG')
    expect(p.form).toBe('tablet')
  })
})
