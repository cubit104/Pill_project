/**
 * Medication reminders as local notifications. The schedule lives in Supabase
 * (lib/cabinet.ts); this module mirrors it into the phone's notification
 * scheduler. Everything is re-planned from scratch on each sync so the phone
 * always matches the account: cancel ours, then schedule the next 14 days.
 */
import {
  LocalNotifications,
  type LocalNotificationSchema,
} from "@capacitor/local-notifications";
import { Badge } from "@capawesome/capacitor-badge";
import type { Reminder } from "./cabinet";
import { isNative } from "./native";

const DAYS_AHEAD = 14;
const ID_BASE = 700_000;

export interface ReminderTarget {
  reminder: Reminder;
  /** Pill name shown in the notification. */
  title: string;
}

/** A "time to refill" nudge: fires once, at `at`. */
export interface RefillTarget {
  title: string;
  at: Date;
  daysLeft: number;
}

const REFILL_SEQ = 90_000; // ids ID_BASE+90000… stay inside our cancel window
const CHANNEL_ID = "pillseek_doses"; // Android 8+: sound/importance live on the channel
// iOS plays nothing unless a sound is named; a name that is not a bundled file falls back to the system default.
const SOUND = "default";

/** `badge` is added to the iOS plugin by patches/@capacitor+local-notifications (patch-package). */
type Notification = LocalNotificationSchema & { badge?: number };

/** Deterministic id per reminder × occurrence so re-planning replaces cleanly. */
function notificationId(seq: number): number {
  return ID_BASE + seq;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === "granted") return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === "granted";
  } catch {
    return false;
  }
}

/** All future dose times (local) for a reminder within the planning window. */
export function upcomingDoses(
  reminder: Reminder,
  from: Date,
  daysAhead = DAYS_AHEAD
): Date[] {
  const out: Date[] = [];
  if (!reminder.enabled) return out;
  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + d
    );
    if (!reminder.days.includes(day.getDay())) continue;
    for (const t of reminder.times) {
      const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
      const at = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hh,
        mm,
        0,
        0
      );
      if (at.getTime() > from.getTime()) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Replace every PillSeek notification with the current schedule (doses + refill nudges). */
export async function syncNotifications(
  targets: ReminderTarget[],
  refills: RefillTarget[] = []
): Promise<number> {
  if (!isNative()) return 0;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter(
      (n) => n.id >= ID_BASE && n.id < ID_BASE + 100_000
    );
    if (ours.length)
      await LocalNotifications.cancel({
        notifications: ours.map((n) => ({ id: n.id })),
      });
  } catch {
    /* nothing pending */
  }
  const now = new Date();
  const list: Notification[] = [];
  let seq = 0;
  // Interleave every reminder by time before capping, so a newly added reminder is never
  // starved by earlier ones filling the window. iOS keeps 64 pending; re-planned on every app open.
  const all: { at: Date; reminder: Reminder; title: string }[] = [];
  for (const { reminder, title } of targets)
    for (const at of upcomingDoses(reminder, now))
      all.push({ at, reminder, title });
  all.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const { at, reminder, title } of all.slice(0, 44)) {
    list.push({
      id: notificationId(seq++),
      title: `Time for ${title}`,
      body: reminder.dose ? `Take ${reminder.dose}` : "Tap to mark it taken",
      schedule: { at, allowWhileIdle: true },
      sound: SOUND,
      channelId: CHANNEL_ID,
      badge: 1, // renumbered below in time order so unread alerts add up
      extra: { reminderId: reminder.id, scheduledAt: at.toISOString() },
      actionTypeId: "PILLSEEK_DOSE",
    });
  }
  let rseq = 0;
  for (const r of refills) {
    if (rseq >= 20) break;
    const at =
      r.at.getTime() > now.getTime() ? r.at : new Date(now.getTime() + 60_000); // already due: nudge in a minute
    list.push({
      id: notificationId(REFILL_SEQ + rseq++),
      title: `Refill ${r.title}`,
      body:
        r.daysLeft <= 0
          ? "You are out. Time to refill."
          : `About ${r.daysLeft} day${
              r.daysLeft === 1 ? "" : "s"
            } of supply left.`,
      schedule: { at, allowWhileIdle: true },
      sound: SOUND,
      channelId: CHANNEL_ID,
      badge: 1,
      extra: { kind: "refill" },
    });
  }
  // iOS shows the badge value of the latest alert, not a running total: number them in
  // time order so three unread alerts read "3". Opening the app clears it and re-plans.
  const ordered = [...list].sort((a, b) => (a.schedule?.at?.getTime() ?? 0) - (b.schedule?.at?.getTime() ?? 0));
  ordered.forEach((n, i) => {
    n.badge = i + 1;
  });
  if (list.length) await LocalNotifications.schedule({ notifications: list });
  return list.length;
}

const SNOOZE_SEQ = 95_000; // ids ID_BASE+95000… (inside our cancel window)
const SNOOZE_MS = 15 * 60_000;

/** Re-notify the same dose 15 minutes from now (the original stays recorded under its scheduled time). */
export async function snoozeDose(extra: { reminderId: string; scheduledAt: string; title?: string; body?: string }): Promise<void> {
  if (!isNative()) return;
  const at = new Date(Date.now() + SNOOZE_MS);
  const n: Notification = {
    id: notificationId(SNOOZE_SEQ + (Date.now() % 1000)),
    title: extra.title ?? "Time for your medicine",
    body: extra.body ?? "Snoozed reminder",
    schedule: { at, allowWhileIdle: true },
    sound: SOUND,
    channelId: CHANNEL_ID,
    badge: 1,
    extra: { reminderId: extra.reminderId, scheduledAt: extra.scheduledAt, snoozed: true },
    actionTypeId: "PILLSEEK_DOSE",
  };
  await LocalNotifications.schedule({ notifications: [n] });
}

/** Clear the app-icon badge (called whenever the app comes to the foreground). */
export async function clearBadge(): Promise<void> {
  if (!isNative()) return;
  try {
    await Badge.clear();
  } catch {
    /* unsupported */
  }
}

/** Register the Taken / Skip buttons shown on the notification, and the Android channel. */
export async function registerDoseActions(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "Medication reminders",
      description: "Dose times and refill nudges",
      importance: 5,
      sound: SOUND,
      vibration: true,
      visibility: 1,
    });
  } catch {
    /* iOS: no channels */
  }
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: "PILLSEEK_DOSE",
          actions: [
            { id: "taken", title: "Taken" },
            { id: "snooze", title: "Remind me in 15 min" },
            { id: "skip", title: "Skip", destructive: true },
          ],
        },
      ],
    });
  } catch {
    /* older platform */
  }
}
