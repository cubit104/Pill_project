import { describe, expect, it } from 'vitest'
import { PLAN_FIRST, PLAN_LAST, SNOOZE_FIRST, SNOOZE_LAST } from './reminders'

/**
 * Opening the app cancels everything in [PLAN_FIRST, PLAN_LAST) and re-plans it.
 * Tapping Snooze on a notification also opens the app, so a snooze scheduled
 * inside that window is destroyed seconds after it is created — which is exactly
 * the bug this guards against.
 */
describe('notification id ranges', () => {
  it('keeps snoozes outside the window the app re-plans', () => {
    expect(SNOOZE_FIRST).toBeGreaterThanOrEqual(PLAN_LAST)
  })

  it('does not overlap', () => {
    expect(SNOOZE_LAST).toBeGreaterThan(SNOOZE_FIRST)
    const overlaps = SNOOZE_FIRST < PLAN_LAST && PLAN_FIRST < SNOOZE_LAST
    expect(overlaps).toBe(false)
  })

  it('leaves room for the doses and refill nudges it plans', () => {
    // 44 doses + 20 refill nudges, with the refill block at +90_000.
    expect(PLAN_LAST - PLAN_FIRST).toBeGreaterThan(90_000 + 20)
  })
})
