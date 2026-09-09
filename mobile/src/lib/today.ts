/**
 * Today's dose list: every reminder time that falls on today, joined with any
 * recorded Taken / Skip event. Pure functions so the cabinet card and the Today
 * screen agree, and so they can be unit-tested.
 */
import type { CabinetItem, DoseEvent, Reminder } from './cabinet'

export type DoseStatus = 'taken' | 'skipped' | 'missed' | 'due' | 'upcoming'

export interface TodayDose {
  key: string
  reminder: Reminder
  item: CabinetItem
  at: Date
  status: DoseStatus
  event: DoseEvent | null
}

/** A dose counts as missed this long after its time with no Taken / Skip. */
export const MISSED_AFTER_MS = 60 * 60_000
/** A dose is "due" from this long before its time. */
export const DUE_BEFORE_MS = 15 * 60_000

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function timeToday(day: Date, hhmm: string): Date | null {
  const [hh, mm] = hhmm.split(':').map((x) => parseInt(x, 10))
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0)
}

export function doseStatus(at: Date, event: DoseEvent | null, now: Date): DoseStatus {
  if (event) return event.status
  const delta = at.getTime() - now.getTime()
  if (delta < -MISSED_AFTER_MS) return 'missed'
  if (delta <= DUE_BEFORE_MS) return 'due'
  return 'upcoming'
}

/** Doses scheduled for the calendar day of `now`, in time order. */
export function todayDoses(items: CabinetItem[], reminders: Reminder[], events: DoseEvent[], now = new Date()): TodayDose[] {
  const day = startOfDay(now)
  const byKey = new Map<string, DoseEvent>()
  for (const e of events) byKey.set(`${e.reminder_id}|${new Date(e.scheduled_at).getTime()}`, e)
  const out: TodayDose[] = []
  for (const r of reminders) {
    if (!r.enabled || !r.days.includes(day.getDay())) continue
    const item = items.find((i) => i.id === r.cabinet_item_id)
    if (!item) continue
    for (const t of r.times) {
      const at = timeToday(day, t)
      if (!at) continue
      const event = byKey.get(`${r.id}|${at.getTime()}`) ?? null
      out.push({ key: `${r.id}|${at.toISOString()}`, reminder: r, item, at, status: doseStatus(at, event, now), event })
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

export interface TodaySummary {
  total: number
  taken: number
  skipped: number
  missed: number
  /** The next dose still to take today (due or upcoming), if any. */
  next: TodayDose | null
}

export function summarize(doses: TodayDose[]): TodaySummary {
  const s: TodaySummary = { total: doses.length, taken: 0, skipped: 0, missed: 0, next: null }
  for (const d of doses) {
    if (d.status === 'taken') s.taken++
    else if (d.status === 'skipped') s.skipped++
    else if (d.status === 'missed') s.missed++
    else if (!s.next) s.next = d
  }
  return s
}
