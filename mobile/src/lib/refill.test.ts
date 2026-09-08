import { describe, expect, it } from 'vitest'
import { pillsPerDose, refillLabel, refillStatus, scheduleRate } from './refill'

const daily = { times: ['08:00', '18:00'], days: [0, 1, 2, 3, 4, 5, 6], dose: '1 tablet', enabled: true }
const base = { pills_on_hand: 30, pills_counted_at: null, pills_per_day: null, fill_quantity: 90, refill_notify_days: 5 }

describe('pillsPerDose', () => {
  it('reads the leading number, fractions and words', () => {
    expect(pillsPerDose('1 tablet')).toBe(1)
    expect(pillsPerDose('2 capsules')).toBe(2)
    expect(pillsPerDose('1/2 tablet')).toBe(0.5)
    expect(pillsPerDose('half a tablet')).toBe(0.5)
    expect(pillsPerDose(null)).toBe(1)
    expect(pillsPerDose('as needed')).toBe(1)
  })
})

describe('scheduleRate', () => {
  it('multiplies times, days and dose', () => {
    expect(scheduleRate(daily)).toBe(2)
    expect(scheduleRate({ ...daily, days: [1, 2, 3, 4, 5] })).toBeCloseTo(10 / 7)
    expect(scheduleRate({ ...daily, enabled: false })).toBeNull()
    expect(scheduleRate(null)).toBeNull()
  })
})

describe('refillStatus', () => {
  const now = new Date(2026, 8, 8, 12, 0)

  it('is null without a count or a rate', () => {
    expect(refillStatus({ ...base, pills_on_hand: null }, daily, now)).toBeNull()
    expect(refillStatus(base, null, now)).toBeNull()
  })

  it('counts down from the day the pills were counted', () => {
    const counted = new Date(2026, 8, 3, 12, 0).toISOString() // 5 days ago at 2/day → 10 used
    const s = refillStatus({ ...base, pills_counted_at: counted }, daily, now)
    expect(s).not.toBeNull()
    expect(s?.remaining).toBe(20)
    expect(s?.daysLeft).toBe(10)
    expect(s?.level).toBe('ok')
    expect(s?.runsOut.getDate()).toBe(18)
    expect(s?.notifyAt.getDate()).toBe(13)
    expect(s?.notifyAt.getHours()).toBe(9)
    expect(refillLabel(s!)).toBe('10 days left')
  })

  it('prefers a manual rate over the schedule', () => {
    const s = refillStatus({ ...base, pills_per_day: 1 }, daily, now)
    expect(s?.daysLeft).toBe(30)
  })

  it('flags soon and out', () => {
    expect(refillStatus({ ...base, pills_on_hand: 8 }, daily, now)?.level).toBe('soon')
    expect(refillLabel(refillStatus({ ...base, pills_on_hand: 8 }, daily, now)!)).toBe('Refill soon · 4 days left')
    const out = refillStatus({ ...base, pills_on_hand: 1 }, daily, now)
    expect(out?.level).toBe('out')
    expect(refillLabel(out!)).toBe('Out of pills')
  })
})
