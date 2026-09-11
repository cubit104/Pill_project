/**
 * Account + cabinet state shared by every screen: who is signed in, the saved
 * pills, reminders, and helpers to change them. Pill details are fetched by
 * slug from the PillSeek API and cached here so the cabinet renders instantly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { getPill, type PillDetail } from './api'
import { accountsEnabled, currentSession, onAuthChange, signOut as authSignOut, type AuthUser } from './auth'
import {
  addToCabinet,
  deleteAccountData,
  deleteReminder,
  listCabinet,
  listDoseEvents,
  listReminders,
  recordDose,
  removeFromCabinet,
  reorderCabinet,
  saveReminder,
  updateCabinetItem,
  type CabinetItem,
  type CabinetPatch,
  type DoseEvent,
  type Reminder,
} from './cabinet'
import { LocalNotifications } from '@capacitor/local-notifications'
import { enqueueDose, flushQueue, type PendingDose } from './doseQueue'
import { isNative } from './native'
import { refillStatus } from './refill'
import { startOfDay } from './today'
import { ensureNotificationPermission, registerDoseActions, snoozeDose, syncNotifications, type RefillTarget } from './reminders'

interface AccountApi {
  enabled: boolean
  /** null while the stored session is being read. */
  ready: boolean
  user: AuthUser | null
  items: CabinetItem[]
  reminders: Reminder[]
  /** Taken / skipped doses since yesterday (for the Today view and the cabinet card). */
  doseEvents: DoseEvent[]
  /** Pill details by slug, filled in the background. */
  pills: Record<string, PillDetail>
  loading: boolean
  error: string | null
  /** Phone notification permission: unknown until the first schedule attempt. */
  notifications: 'unknown' | 'granted' | 'denied'
  /** How many dose/refill notifications are currently scheduled on this phone. */
  scheduled: number
  refresh: () => Promise<void>
  has: (slug: string) => boolean
  add: (slug: string) => Promise<CabinetItem>
  remove: (id: string) => Promise<void>
  update: (id: string, patch: CabinetPatch) => Promise<void>
  reorder: (ids: string[]) => Promise<void>
  upsertReminder: (r: Omit<Reminder, 'id'> & { id?: string }) => Promise<Reminder>
  removeReminder: (id: string) => Promise<void>
  /** Record a dose as taken or skipped (also called from the notification buttons). */
  markDose: (reminderId: string, scheduledAt: Date, status: DoseEvent['status']) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
}

const Ctx = createContext<AccountApi | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!accountsEnabled)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [items, setItems] = useState<CabinetItem[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [doseEvents, setDoseEvents] = useState<DoseEvent[]>([])
  const [pills, setPills] = useState<Record<string, PillDetail>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [scheduled, setScheduled] = useState(0)
  const pillsRef = useRef(pills)
  pillsRef.current = pills

  // Session bootstrap + live auth changes.
  useEffect(() => {
    if (!accountsEnabled) return
    let cancelled = false
    void currentSession().then((s) => {
      if (cancelled) return
      setUser(s?.user ? { id: s.user.id, email: s.user.email ?? null } : null)
      setReady(true)
    })
    const off = onAuthChange((u) => setUser(u))
    void registerDoseActions()
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const fetchPills = useCallback(async (slugs: string[]) => {
    const missing = slugs.filter((s) => !pillsRef.current[s])
    if (missing.length === 0) return
    const results = await Promise.allSettled(missing.map((s) => getPill(s)))
    setPills((prev) => {
      const next = { ...prev }
      results.forEach((r, i) => {
        const slug = missing[i]
        if (r.status === 'fulfilled' && slug) next[slug] = r.value
      })
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([])
      setReminders([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const since = startOfDay(new Date())
      since.setDate(since.getDate() - 30)
      const [list, rems, events] = await Promise.all([listCabinet(), listReminders(), listDoseEvents(since)])
      setItems(list)
      setReminders(rems)
      setDoseEvents(events)
      void fetchPills(list.map((i) => i.slug))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your cabinet')
    } finally {
      setLoading(false)
    }
  }, [user, fetchPills])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Show the dose as answered straight away, whatever the network is doing. */
  const applyLocally = useCallback((reminderId: string, scheduledAt: Date, status: DoseEvent['status'], actedAt: string) => {
    const iso = scheduledAt.toISOString()
    setDoseEvents((prev) => {
      const rest = prev.filter((e) => !(e.reminder_id === reminderId && new Date(e.scheduled_at).getTime() === scheduledAt.getTime()))
      return [...rest, { id: `local-${reminderId}-${iso}`, reminder_id: reminderId, scheduled_at: iso, status, acted_at: actedAt }]
    })
  }, [])

  const markDose = useCallback(
    async (reminderId: string, scheduledAt: Date, status: DoseEvent['status']) => {
      const actedAt = new Date().toISOString()
      applyLocally(reminderId, scheduledAt, status, actedAt)
      const pending: PendingDose = { reminderId, scheduledAt: scheduledAt.toISOString(), status, actedAt }
      if (!user) {
        // Signed out, or the session is still loading after a cold start from a
        // notification button: keep it and send once the account is ready.
        await enqueueDose(pending)
        return
      }
      try {
        await recordDose(user.id, reminderId, scheduledAt, status)
      } catch (err) {
        await enqueueDose(pending)
        throw err
      }
    },
    [user, applyLocally],
  )

  /** Send anything marked while offline or signed out. Safe to call repeatedly. */
  const flushDoses = useCallback(async () => {
    if (!user) return
    await flushQueue(async (d) => {
      await recordDose(user.id, d.reminderId, new Date(d.scheduledAt), d.status)
      applyLocally(d.reminderId, new Date(d.scheduledAt), d.status, d.actedAt)
    })
  }, [user, applyLocally])

  // On sign-in, on launch, and whenever the app comes back to the foreground.
  useEffect(() => {
    if (!user) return
    void flushDoses()
    if (!isNative()) return
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void flushDoses()
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [user, flushDoses])

  // Taken / Skip / Snooze on the notification itself. This has to be listening
  // from the moment the app launches: tapping a button on a notification while
  // the app is closed delivers the action immediately, long before the stored
  // session has loaded. Anything that arrives early is queued by markDose and
  // sent once the account is ready.
  const markDoseRef = useRef(markDose)
  markDoseRef.current = markDose
  useEffect(() => {
    if (!accountsEnabled) return
    const sub = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const extra = (a.notification.extra ?? {}) as { reminderId?: string; scheduledAt?: string }
      if (!extra.reminderId || !extra.scheduledAt) return
      const at = new Date(extra.scheduledAt)
      if (a.actionId === 'taken') void markDoseRef.current(extra.reminderId, at, 'taken').catch(() => {})
      else if (a.actionId === 'skip') void markDoseRef.current(extra.reminderId, at, 'skipped').catch(() => {})
      else if (a.actionId === 'snooze')
        void snoozeDose({ reminderId: extra.reminderId, scheduledAt: extra.scheduledAt, title: a.notification.title, body: a.notification.body })
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [])

  // Mirror the reminder schedule into the phone's notifications whenever it changes.
  useEffect(() => {
    if (!user) return
    const targets = reminders
      .map((reminder) => {
        const item = items.find((i) => i.id === reminder.cabinet_item_id)
        const pill = item ? pills[item.slug] : undefined
        const title = item?.nickname || pill?.drug_name || item?.slug || 'your medicine'
        const supply = item ? refillStatus(item, reminder) : null
        return { reminder, title, supplyDaysLeft: supply ? supply.daysLeft : null }
      })
      .filter((t) => t.reminder.enabled)
    // One refill nudge per pill that has a count and is running low within the plan window.
    const refills: RefillTarget[] = []
    for (const item of items) {
      const status = refillStatus(item, reminders.find((r) => r.cabinet_item_id === item.id) ?? null)
      if (!status) continue
      const title = item.nickname || pills[item.slug]?.drug_name || item.slug
      refills.push({ title, at: status.notifyAt, daysLeft: status.daysLeft })
    }
    // Ask for permission here too (not only when saving in-app): reminders made on the
    // website must still ring on the phone.
    const run = async () => {
      if (targets.length > 0 || refills.length > 0) {
        const ok = await ensureNotificationPermission()
        setNotifications(ok ? 'granted' : isNative() ? 'denied' : 'unknown')
      }
      setScheduled(await syncNotifications(targets, refills))
    }
    void run()
  }, [user, reminders, items, pills])

  const api = useMemo<AccountApi>(
    () => ({
      enabled: accountsEnabled,
      ready,
      user,
      items,
      reminders,
      doseEvents,
      pills,
      loading,
      error,
      notifications,
      scheduled,
      refresh,
      has: (slug) => items.some((i) => i.slug === slug),
      add: async (slug) => {
        if (!user) throw new Error('Sign in to save pills')
        const item = await addToCabinet(user.id, slug)
        setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]))
        void fetchPills([slug])
        return item
      },
      remove: async (id) => {
        await removeFromCabinet(id)
        setItems((prev) => prev.filter((i) => i.id !== id))
        setReminders((prev) => prev.filter((r) => r.cabinet_item_id !== id))
      },
      update: async (id, patch) => {
        await updateCabinetItem(id, patch)
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
      },
      reorder: async (ids) => {
        setItems((prev) => ids.map((id, position) => ({ ...(prev.find((i) => i.id === id) as CabinetItem), position })).filter(Boolean))
        await reorderCabinet(ids)
      },
      upsertReminder: async (r) => {
        if (!user) throw new Error('Sign in first')
        const saved = await saveReminder(user.id, r)
        setReminders((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]))
        return saved
      },
      removeReminder: async (id) => {
        await deleteReminder(id)
        setReminders((prev) => prev.filter((r) => r.id !== id))
      },
      markDose,
      signOut: async () => {
        await authSignOut()
        setUser(null)
        setItems([])
        setReminders([])
        setDoseEvents([])
        void syncNotifications([])
      },
      deleteAccount: async () => {
        await deleteAccountData()
        await authSignOut()
        setUser(null)
        setItems([])
        setReminders([])
        void syncNotifications([])
      },
    }),
    [ready, user, items, reminders, doseEvents, pills, loading, error, notifications, scheduled, refresh, fetchPills, markDose],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useAccount(): AccountApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAccount must be used inside AccountProvider')
  return ctx
}
