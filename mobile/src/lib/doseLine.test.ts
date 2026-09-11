import { describe, expect, it } from 'vitest'
import { doseLine } from './reminders'

describe('doseLine', () => {
  it('counts the doses when there is more than one that day', () => {
    expect(doseLine({ index: 2, total: 3, supplyLeftAtDose: null })).toBe('Dose 2 of 3 today')
  })

  it('says nothing extra for a single uneventful dose', () => {
    expect(doseLine({ index: 1, total: 1, supplyLeftAtDose: null })).toBe('')
    expect(doseLine({ index: 1, total: 1, supplyLeftAtDose: 30 })).toBe('')
  })

  it('warns about supply before counting doses', () => {
    expect(doseLine({ index: 2, total: 3, supplyLeftAtDose: 5 })).toBe('5 days of pills left')
    expect(doseLine({ index: 1, total: 1, supplyLeftAtDose: 7 })).toBe('7 days of pills left')
  })

  it('handles the last day and running out', () => {
    expect(doseLine({ index: 1, total: 2, supplyLeftAtDose: 1 })).toBe('1 day of pills left')
    expect(doseLine({ index: 1, total: 2, supplyLeftAtDose: 0 })).toBe('Last dose — time to refill')
    expect(doseLine({ index: 1, total: 2, supplyLeftAtDose: -3 })).toBe('Last dose — time to refill')
  })

  it('ignores a comfortable supply', () => {
    expect(doseLine({ index: 1, total: 2, supplyLeftAtDose: 8 })).toBe('Dose 1 of 2 today')
  })
})
