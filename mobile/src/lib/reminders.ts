/**
 * Medication reminders as local notifications. The schedule lives in Supabase
 * (lib/cabinet.ts); this module mirrors it into the phone's notification
 * scheduler. Everything is re-planned from scratch on each sync so the phone
 * always matches the account: cancel ours, then schedule the next 14 days.
 */
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import type { Reminder } from './cabinet'
import { isNative } from './native'

const DAYS_AHEAD = 14
const ID_BASE = 700_000

export interface ReminderTarget {
  reminder: Reminder
  /** Pill name shown in the notification. */
  title: string
}

/** A "time to refill" nudge: fires once, at `at`. */
export interface RefillTarget {
  title: string
  at: Date
  daysLeft: number
}

const REFILL_SEQ = 90_000 // ids ID_BASE+90000… stay inside our cancel window
const CHANNEL_ID = 'pillseek_doses' // Android 8+: sound/importance live on the channel
// iOS plays nothing unless a sound is named; a name that is not a bundled file falls back to the system default.
const SOUND = 'default'

/** Deterministic id per reminder × occurrence so re-planning replaces cleanly. */
function notificationId(seq: number): number {
  return ID_BASE + seq
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false
  try {
    const cur = await LocalNotifications.checkPermissions()
    if (cur.display === 'granted') return true
    const req = await LocalNotifications.requestPermissions()
    return req.display === 'granted'
  } catch {
    return false
  }
}

/** All future dose times (local) for a reminder within the planning window. */
export function upcomingDoses(reminder: Reminder, from: Date, daysAhead = DAYS_AHEAD): Date[] {
  const out: Date[] = []
  if (!reminder.enabled) return out
  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d)
    if (!reminder.days.includes(day.getDay())) continue
    for (const t of reminder.times) {
      const [hh, mm] = t.split(':').map((x) => parseInt(x, 10))
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0)
      if (at.getTime() > from.getTime()) out.push(at)
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}

/** Replace every PillSeek notification with the current schedule (doses + refill nudges). */
export async function syncNotifications(targets: ReminderTarget[], refills: RefillTarget[] = []): Promise<number> {
  if (!isNative()) return 0
  try {
    const pending = await LocalNotifications.getPending()
    const ours = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + 100_000)
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) })
  } catch {
    /* nothing pending */
  }
  const now = new Date()
  const list: LocalNotificationSchema[] = []
  let seq = 0
  for (const { reminder, title } of targets) {
    for (const at of upcomingDoses(reminder, now)) {
      if (list.length >= 60) break // iOS keeps 64 pending; re-planned on every app open
      list.push({
        id: notificationId(seq++),
        title: `Time for ${title}`,
        body: reminder.dose ? `Take ${reminder.dose}` : 'Tap to mark it taken',
        schedule: { at, allowWhileIdle: true },
        sound: SOUND,
        channelId: CHANNEL_ID,
        extra: { reminderId: reminder.id, scheduledAt: at.toISOString() },
        actionTypeId: 'PILLSEEK_DOSE',
      })
    }
  }
  let rseq = 0
  for (const r of refills) {
    if (rseq >= 20) break
    const at = r.at.getTime() > now.getTime() ? r.at : new Date(now.getTime() + 60_000) // already due: nudge in a minute
    list.push({
      id: notificationId(REFILL_SEQ + rseq++),
      title: `Refill ${r.title}`,
      body: r.daysLeft <= 0 ? 'You are out. Time to refill.' : `About ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} of supply left.`,
      schedule: { at, allowWhileIdle: true },
      sound: SOUND,
      channelId: CHANNEL_ID,
      extra: { kind: 'refill' },
    })
  }
  if (list.length) await LocalNotifications.schedule({ notifications: list })
  return list.length
}

/** Register the Taken / Skip buttons shown on the notification, and the Android channel. */
export async function registerDoseActions(): Promise<void> {
  if (!isNative()) return
  try {
    await LocalNotifications.createChannel({ id: CHANNEL_ID, name: 'Medication reminders', description: 'Dose times and refill nudges', importance: 5, sound: SOUND, vibration: true, visibility: 1 })
  } catch {
    /* iOS: no channels */
  }
  try {
    await LocalNotifications.registerActionTypes({
      types: [{ id: 'PILLSEEK_DOSE', actions: [{ id: 'taken', title: 'Taken' }, { id: 'skip', title: 'Skip', destructive: true }] }],
    })
  } catch {
    /* older platform */
  }
}
