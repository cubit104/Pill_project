import { describe, expect, it } from 'vitest'
import type { CabinetItem, DoseEvent, Reminder } from './cabinet'
import { adherence, summarize, todayDoses } from './today'

const item: CabinetItem = {
  id: 'i1',
  slug: 'aspirin-l467',
  nickname: null,
  notes: null,
  position: 0,
  created_at: '2026-09-01T00:00:00Z',
  pills_on_hand: null,
  pills_counted_at: null,
  pills_per_day: null,
  fill_quantity: null,
  refill_notify_days: 5,
  directions: null,
  rx_number: null,
  pharmacy_name: null,
  pharmacy_phone: null,
  prescriber: null,
  refills_left: null,
}
const reminder: Reminder = { id: 'r1', cabinet_item_id: 'i1', times: ['08:00', '20:00'], days: [0, 1, 2, 3, 4, 5, 6], dose: '1 tablet', enabled: true, timezone: null }

function taken(day: Date, hhmm: string, status: DoseEvent['status'] = 'taken'): DoseEvent {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h ?? 0, m ?? 0)
  return { id: `e-${at.getTime()}`, reminder_id: 'r1', scheduled_at: at.toISOString(), status, acted_at: at.toISOString() }
}

describe('todayDoses / summarize', () => {
  it('lists doses in order with statuses', () => {
    const now = new Date(2026, 8, 9, 12, 0) // noon
    const today = new Date(2026, 8, 9)
    const doses = todayDoses([item], [reminder], [taken(today, '08:00')], now)
    expect(doses.map((d) => d.status)).toEqual(['taken', 'upcoming'])
    const s = summarize(doses)
    expect(s.taken).toBe(1)
    expect(s.total).toBe(2)
    expect(s.next?.at.getHours()).toBe(20)
  })

  it('marks an unanswered dose missed an hour later', () => {
    const now = new Date(2026, 8, 9, 9, 30)
    expect(todayDoses([item], [reminder], [], now)[0]?.status).toBe('missed')
  })
})

describe('adherence', () => {
  it('counts good days and the streak', () => {
    const now = new Date(2026, 8, 9, 12, 0)
    const events: DoseEvent[] = []
    // Three perfect days before today, then a bad day, then today morning taken.
    for (const back of [4, 3, 2]) {
      const d = new Date(2026, 8, 9 - back)
      events.push(taken(d, '08:00'), taken(d, '20:00'))
    }
    const bad = new Date(2026, 8, 8)
    events.push(taken(bad, '08:00'), taken(bad, '20:00', 'skipped'))
    events.push(taken(new Date(2026, 8, 9), '08:00'))
    const a = adherence([item], [reminder], events, now)
    expect(a.countedDays).toBe(7)
    expect(a.goodDays).toBe(4) // 3 perfect days + today so far
    expect(a.streak).toBe(1) // today good, yesterday bad
  })

  it('does not break the streak on days with nothing due', () => {
    const now = new Date(2026, 8, 9, 12, 0)
    const weekdays: Reminder = { ...reminder, days: [1, 2, 3, 4, 5], times: ['08:00'] }
    const events = [taken(new Date(2026, 8, 4), '08:00'), taken(new Date(2026, 8, 7), '08:00'), taken(new Date(2026, 8, 8), '08:00'), taken(new Date(2026, 8, 9), '08:00')]
    const a = adherence([item], [weekdays], events, now)
    expect(a.streak).toBe(4) // Wed 9, Tue 8, Mon 7, (weekend skipped), Fri 4
  })
})
