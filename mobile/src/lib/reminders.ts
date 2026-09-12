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
import { tr } from "./i18n";
import { isNative } from "./native";

const DAYS_AHEAD = 14;
const ID_BASE = 700_000;
/**
 * Scheduled doses and refill nudges live in [PLAN_FIRST, PLAN_LAST) and are all
 * cancelled and re-planned every time the app opens. Snoozes must NOT live in
 * there: tapping Snooze launches the app, so a snooze scheduled inside this
 * window was wiped by the very next re-plan, seconds after it was created.
 */
export const PLAN_FIRST = ID_BASE;
export const PLAN_LAST = ID_BASE + 100_000;
/** One-off snoozes, deliberately outside the re-planned window. */
export const SNOOZE_FIRST = ID_BASE + 200_000;
export const SNOOZE_LAST = SNOOZE_FIRST + 1_000;

export interface ReminderTarget {
  reminder: Reminder;
  /** Pill name shown in the notification. */
  title: string;
  /** Days of supply left as of now, when the user tracks refills for this pill. */
  supplyDaysLeft?: number | null;
}

/** Calendar day key, so doses can be counted per day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * The third line of the banner: something worth knowing, not an instruction.
 * Days of supply wins when the pill is tracked, since it is always useful and
 * turns urgent on its own; otherwise the dose count. A single untracked dose
 * gets no third line rather than filler.
 */
export function doseLine(input: { index: number; total: number; supplyLeftAtDose: number | null }): string {
  const { index, total, supplyLeftAtDose } = input;
  if (supplyLeftAtDose !== null) {
    if (supplyLeftAtDose <= 0) return tr("Last dose — time to refill");
    if (supplyLeftAtDose === 1) return tr("1 day of pills left");
    return tr("{n} days of pills left", { n: supplyLeftAtDose });
  }
  if (total > 1) return tr("Dose {index} of {total} today", { index, total });
  return "";
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

/** `badge` and `interruptionLevel` are added to the iOS plugin by
 * patches/@capacitor+local-notifications (patch-package). */
type Notification = LocalNotificationSchema & {
  badge?: number;
  subtitle?: string;
  interruptionLevel?: "passive" | "active" | "timeSensitive" | "critical";
};

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
      (n) => n.id >= PLAN_FIRST && n.id < PLAN_LAST
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
  const all: { at: Date; reminder: Reminder; title: string; supplyDaysLeft?: number | null }[] = [];
  for (const { reminder, title, supplyDaysLeft } of targets)
    for (const at of upcomingDoses(reminder, now))
      all.push({ at, reminder, title, supplyDaysLeft });
  all.sort((a, b) => a.at.getTime() - b.at.getTime());
  // How many doses fall on each day, so a banner can say "Dose 2 of 3 today".
  const perDay = new Map<string, number>();
  for (const x of all) perDay.set(dayKey(x.at), (perDay.get(dayKey(x.at)) ?? 0) + 1);
  const countedSoFar = new Map<string, number>();
  for (const { at, reminder, title, supplyDaysLeft } of all.slice(0, 44)) {
    const key = dayKey(at);
    const index = (countedSoFar.get(key) ?? 0) + 1;
    countedSoFar.set(key, index);
    const supplyLeftAtDose =
      supplyDaysLeft === null || supplyDaysLeft === undefined
        ? null
        : supplyDaysLeft - daysBetween(now, at);
    list.push({
      id: notificationId(seq++),
      title: tr("Time for {name}", { name: title }),
      // Three lines: what, how much, and something worth knowing.
      subtitle: reminder.dose ? tr("Take {dose}", { dose: reminder.dose }) : tr("Time to take it"),
      body: doseLine({ index, total: perDay.get(key) ?? 1, supplyLeftAtDose }),
      schedule: { at, allowWhileIdle: true },
      sound: SOUND,
      channelId: CHANNEL_ID,
      badge: 1, // renumbered below in time order so unread alerts add up
      // A missed dose matters now: break through Focus and show the larger banner.
      interruptionLevel: "timeSensitive",
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
      title: tr("Refill {name}", { name: r.title }),
      body:
        r.daysLeft <= 0
          ? tr("You are out. Time to refill.")
          : r.daysLeft === 1
            ? tr("About 1 day of supply left.")
            : tr("About {n} days of supply left.", { n: r.daysLeft }),
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

const SNOOZE_SEQ = SNOOZE_FIRST - ID_BASE; // outside the re-planned window, so a snooze survives app launch
const SNOOZE_MS = 15 * 60_000;

/** Re-notify the same dose 15 minutes from now (the original stays recorded under its scheduled time). */
export async function snoozeDose(extra: { reminderId: string; scheduledAt: string; title?: string; body?: string }): Promise<void> {
  if (!isNative()) return;
  const at = new Date(Date.now() + SNOOZE_MS);
  const n: Notification = {
    id: notificationId(SNOOZE_SEQ + (Date.now() % 1000)),
    title: extra.title ?? tr("Time for your medicine"),
    body: extra.body ?? tr("Snoozed reminder"),
    schedule: { at, allowWhileIdle: true },
    sound: SOUND,
    channelId: CHANNEL_ID,
    badge: 1,
    extra: { reminderId: extra.reminderId, scheduledAt: extra.scheduledAt, snoozed: true },
    actionTypeId: "PILLSEEK_DOSE",
  };
  await LocalNotifications.schedule({ notifications: [n] });
}

/** Drop any pending snooze (used on sign-out; the planned window is cleared separately). */
export async function cancelSnoozes(): Promise<void> {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter(
      (n) => n.id >= SNOOZE_FIRST && n.id < SNOOZE_LAST
    );
    if (ours.length)
      await LocalNotifications.cancel({
        notifications: ours.map((n) => ({ id: n.id })),
      });
  } catch {
    /* nothing pending */
  }
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
      name: tr("Medication reminders"),
      description: tr("Dose times and refill nudges"),
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
            { id: "taken", title: tr("Taken") },
            { id: "snooze", title: tr("Remind me in 15 min") },
            { id: "skip", title: tr("Skip"), destructive: true },
          ],
        },
      ],
    });
  } catch {
    /* older platform */
  }
}
