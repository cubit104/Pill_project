/**
 * Refill arithmetic, shared in spirit with the website (frontend/app/lib/refill.ts
 * is a copy — keep them in sync). The user enters a pill count; the daily rate
 * comes from the reminder schedule unless they typed one. Everything is derived
 * on the client from those two numbers plus the date of the count.
 */

export interface RefillFields {
  pills_on_hand: number | null
  pills_counted_at: string | null
  pills_per_day: number | null
  fill_quantity: number | null
  refill_notify_days: number
}

export interface ScheduleLike {
  times: string[]
  days: number[]
  dose: string | null
  enabled: boolean
}

export interface RefillStatus {
  /** Pills estimated to be left right now (never below 0). */
  remaining: number
  /** Pills used per day, from the reminder or the manual rate. */
  perDay: number
  /** Whole days of supply left (0 when out). */
  daysLeft: number
  /** Local date the supply runs out. */
  runsOut: Date
  /** Date the "time to refill" nudge fires (runsOut minus notify days, at 9:00). */
  notifyAt: Date
  level: 'ok' | 'soon' | 'out'
}

/** "1 tablet" → 1, "2 capsules" → 2, "1/2 tablet" → 0.5, "half" → 0.5, unknown → 1. */
export function pillsPerDose(dose: string | null | undefined): number {
  if (!dose) return 1
  const s = dose.trim().toLowerCase()
  if (/^(half|½)/.test(s)) return 0.5
  const frac = /^(\d+)\s*\/\s*(\d+)/.exec(s)
  if (frac) {
    const n = parseInt(frac[1] ?? '1', 10)
    const d = parseInt(frac[2] ?? '1', 10)
    return d > 0 ? n / d : 1
  }
  const num = /^(\d+(?:\.\d+)?)/.exec(s)
  const v = num ? parseFloat(num[1] ?? '1') : 1
  return v > 0 && v <= 100 ? v : 1
}

/** Daily consumption implied by a reminder schedule, or null without one. */
export function scheduleRate(reminder: ScheduleLike | null | undefined): number | null {
  if (!reminder || !reminder.enabled || reminder.times.length === 0 || reminder.days.length === 0) return null
  const rate = (reminder.times.length * reminder.days.length * pillsPerDose(reminder.dose)) / 7
  return rate > 0 ? rate : null
}

/** Effective rate: manual value wins, then the reminder, else null (cannot estimate). */
export function effectiveRate(item: Pick<RefillFields, 'pills_per_day'>, reminder: ScheduleLike | null | undefined): number | null {
  if (item.pills_per_day && item.pills_per_day > 0) return item.pills_per_day
  return scheduleRate(reminder)
}

/** Null when the user has not entered a count, or no rate is known. */
export function refillStatus(item: RefillFields, reminder: ScheduleLike | null | undefined, now = new Date()): RefillStatus | null {
  if (item.pills_on_hand === null || item.pills_on_hand === undefined || !Number.isFinite(item.pills_on_hand)) return null
  const perDay = effectiveRate(item, reminder)
  if (!perDay || !Number.isFinite(perDay) || perDay <= 0) return null
  const counted = item.pills_counted_at ? new Date(item.pills_counted_at) : now
  const elapsedDays = Math.max(0, (now.getTime() - counted.getTime()) / 86_400_000)
  const remaining = Math.max(0, item.pills_on_hand - elapsedDays * perDay)
  const daysLeft = Math.floor(remaining / perDay)
  const runsOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLeft)
  const notifyAt = new Date(runsOut.getFullYear(), runsOut.getMonth(), runsOut.getDate() - item.refill_notify_days, 9, 0, 0, 0)
  // 'out' only when nothing is left; under a day of supply still counts as 'soon'.
  const level: RefillStatus['level'] = remaining <= 0 ? 'out' : remaining < perDay || daysLeft <= item.refill_notify_days ? 'soon' : 'ok'
  return { remaining: Math.round(remaining * 10) / 10, perDay, daysLeft, runsOut, notifyAt, level }
}

/** Short label for a badge: "12 days left", "Refill soon · 3 days", "Out of pills". */
export function refillLabel(s: RefillStatus): string {
  if (s.level === 'out') return 'Out of pills'
  if (s.level === 'soon') return s.daysLeft === 0 ? 'Refill today' : `Refill soon · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`
  return `${s.daysLeft} days left`
}
