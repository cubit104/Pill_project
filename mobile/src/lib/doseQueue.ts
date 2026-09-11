/**
 * Doses marked while the phone is offline, or before the account finished
 * loading, are parked here and sent on the next opportunity. Nothing is ever
 * dropped silently: a dose you tapped Taken on always reaches the account.
 *
 * The list is small (one entry per dose) and each entry is identified by
 * reminder + scheduled time, so re-sending is harmless.
 */
import { Preferences } from '@capacitor/preferences'

const KEY = 'pillseek.doseQueue.v1'
const MAX = 200

export interface PendingDose {
  reminderId: string
  /** ISO time of the dose this answers. */
  scheduledAt: string
  status: 'taken' | 'skipped'
  /** When the user actually tapped, so a late send keeps the real moment. */
  actedAt: string
}

function isPending(v: unknown): v is PendingDose {
  const o = v as PendingDose | null
  return (
    !!o &&
    typeof o.reminderId === 'string' &&
    typeof o.scheduledAt === 'string' &&
    (o.status === 'taken' || o.status === 'skipped') &&
    typeof o.actedAt === 'string'
  )
}

/** Later entries for the same dose replace earlier ones (tapping Taken then Skip keeps Skip). */
export function mergeQueue(existing: PendingDose[], incoming: PendingDose[]): PendingDose[] {
  const byDose = new Map<string, PendingDose>()
  for (const d of [...existing, ...incoming]) byDose.set(`${d.reminderId}|${d.scheduledAt}`, d)
  return [...byDose.values()].slice(-MAX)
}

export async function loadQueue(): Promise<PendingDose[]> {
  try {
    const { value } = await Preferences.get({ key: KEY })
    const parsed: unknown = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.filter(isPending) : []
  } catch {
    return []
  }
}

async function save(list: PendingDose[]): Promise<void> {
  try {
    await Preferences.set({ key: KEY, value: JSON.stringify(list) })
  } catch {
    /* storage full or unavailable: the dose is still in memory for this session */
  }
}

export async function enqueueDose(dose: PendingDose): Promise<void> {
  await save(mergeQueue(await loadQueue(), [dose]))
}

/**
 * Try to send everything queued. `send` should reject when the write fails, so
 * failures stay queued for the next attempt. Returns how many were sent.
 */
export async function flushQueue(send: (dose: PendingDose) => Promise<void>): Promise<number> {
  const queue = await loadQueue()
  if (queue.length === 0) return 0
  const failed: PendingDose[] = []
  let sent = 0
  for (const dose of queue) {
    try {
      await send(dose)
      sent++
    } catch {
      failed.push(dose)
    }
  }
  await save(failed)
  return sent
}

export async function clearQueue(): Promise<void> {
  await save([])
}
