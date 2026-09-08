'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '../../lib/image-url'
import {
  addToCabinet,
  currentUser,
  deleteAccountData,
  deleteReminder,
  formatDays,
  formatTime,
  listCabinet,
  listReminders,
  onAuthChange,
  removeFromCabinet,
  requestEmailCode,
  saveReminder,
  signOut,
  updateCabinetItem,
  verifyEmailCode,
  type CabinetItem,
  type CabinetUser,
  type Reminder,
} from '../../lib/cabinet'
import { effectiveRate, refillLabel, refillStatus, scheduleRate } from '../../lib/refill'

interface PillInfo {
  slug: string
  name: string
  strength: string | null
  imprint: string | null
  image: string
}

const TIME_PRESETS: { label: string; time: string }[] = [
  { label: 'Morning', time: '08:00' },
  { label: 'Noon', time: '12:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Bedtime', time: '22:00' },
]
const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

async function fetchPill(slug: string): Promise<PillInfo> {
  const res = await fetch(`/api/pill/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`Pill ${slug} not found`)
  const raw = (await res.json()) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return {
    slug,
    name: str(raw.drug_name) ?? str(raw.medicine_name) ?? slug,
    strength: str(raw.strength),
    imprint: str(raw.imprint),
    image: resolveImageUrl(raw as { image_url?: string | null; images?: string[] }),
  }
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500'
const primaryBtn =
  'inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50'
const secondaryBtn =
  'inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50'

// ---------------------------------------------------------------------------

function SignIn({ onSignedIn }: { onSignedIn: (u: CabinetUser) => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await requestEmailCode(email)
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setError('')
    try {
      onSignedIn(await verifyEmailCode(email, code))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify the code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Sign in or create account</h2>
      <p className="mt-1 text-sm text-slate-600">No password or sign-up form. We email you a 6-digit code; a new account is created the first time.</p>
      {step === 'email' ? (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label className="block text-sm font-medium text-slate-700" htmlFor="cabinet-email">Email</label>
          <input id="cabinet-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" />
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </form>
      ) : (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <p className="text-sm text-slate-600">We sent a code to <strong>{email.trim()}</strong>. Check spam if it does not arrive.</p>
          <label className="block text-sm font-medium text-slate-700" htmlFor="cabinet-code">6-digit code</label>
          <input
            id="cabinet-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`${inputClass} font-mono text-xl tracking-[0.3em]`}
            placeholder="123456"
          />
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy || code.length < 6} className={`${primaryBtn} w-full`}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }} className="w-full text-sm font-medium text-emerald-700 hover:underline">
            Use a different email
          </button>
        </form>
      )}
      <p className="mt-5 text-xs text-slate-500">
        Your cabinet is private to your account. Read our <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ReminderEditor({
  userId,
  item,
  existing,
  onSaved,
  onDeleted,
  onClose,
}: {
  userId: string
  item: CabinetItem
  existing: Reminder | null
  onSaved: (r: Reminder) => void
  onDeleted: () => void
  onClose: () => void
}) {
  const [times, setTimes] = useState<string[]>(existing?.times ?? ['08:00'])
  const [days, setDays] = useState<number[]>(existing?.days ?? ALL_DAYS)
  const [dose, setDose] = useState(existing?.dose ?? '1 tablet')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggleTime = (t: string) => setTimes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t].sort()))
  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()))

  const save = async () => {
    if (times.length === 0 || days.length === 0) {
      setError('Pick at least one time and one day.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const r = await saveReminder(userId, {
        id: existing?.id,
        cabinet_item_id: item.id,
        times,
        days,
        dose: dose.trim() || null,
        enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      })
      onSaved(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setBusy(true)
    try {
      await deleteReminder(existing.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Reminder">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-900">{existing ? 'Edit reminder' : 'Set a reminder'}</h3>
        <p className="mt-1 text-sm text-slate-600">Notifications arrive on your phone through the PillSeek app. The website shows the schedule.</p>

        <p className="mt-4 text-sm font-medium text-slate-700">Times</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TIME_PRESETS.map((p) => (
            <button key={p.time} type="button" onClick={() => toggleTime(p.time)} className={`rounded-full border px-3 py-1.5 text-sm ${times.includes(p.time) ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}>
              {p.label} · {formatTime(p.time)}
            </button>
          ))}
          {times.filter((t) => !TIME_PRESETS.some((p) => p.time === t)).map((t) => (
            <button key={t} type="button" onClick={() => toggleTime(t)} className="rounded-full border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">
              {formatTime(t)} ×
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input type="time" value={custom} onChange={(e) => setCustom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="Custom time" />
          <button type="button" disabled={!custom} onClick={() => { if (custom && !times.includes(custom)) setTimes((ts) => [...ts, custom].sort()); setCustom('') }} className={secondaryBtn}>
            Add time
          </button>
        </div>

        <p className="mt-4 text-sm font-medium text-slate-700">Days</p>
        <div className="mt-2 flex gap-1.5">
          {ALL_DAYS.map((d) => (
            <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={days.includes(d)} className={`h-9 w-9 rounded-full border text-sm font-semibold ${days.includes(d) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-slate-600'}`}>
              {DAY_NAMES[d]}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="reminder-dose">Dose</label>
        <input id="reminder-dose" value={dose} onChange={(e) => setDose(e.target.value)} maxLength={80} className={`${inputClass} mt-1`} placeholder="1 tablet" />

        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {existing && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="mr-auto text-sm font-medium text-red-600 hover:underline">Delete reminder</button>
          )}
          <button type="button" disabled={busy} onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function RefillEditor({
  item,
  name,
  reminder,
  onSaved,
  onClose,
}: {
  item: CabinetItem
  name: string
  reminder: Reminder | null
  onSaved: (patch: Partial<CabinetItem>) => void
  onClose: () => void
}) {
  const fromSchedule = scheduleRate(reminder)
  const [onHand, setOnHand] = useState(item.pills_on_hand === null ? '' : String(item.pills_on_hand))
  const [perDay, setPerDay] = useState(item.pills_per_day === null ? '' : String(item.pills_per_day))
  const [fill, setFill] = useState(item.fill_quantity === null ? '' : String(item.fill_quantity))
  const [notify, setNotify] = useState(String(item.refill_notify_days))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const preview = refillStatus(
    { pills_on_hand: num(onHand), pills_counted_at: null, pills_per_day: num(perDay), fill_quantity: num(fill), refill_notify_days: Number(notify) || 0 },
    reminder,
  )

  const save = async (refilled = false) => {
    const count = refilled ? num(fill) : num(onHand)
    if (count === null || !Number.isFinite(count) || count < 0) {
      setError(refilled ? 'Enter how many pills a refill gives you.' : 'Enter how many pills you have.')
      return
    }
    if (!effectiveRate({ pills_per_day: num(perDay) }, reminder)) {
      setError('Set a reminder or enter pills per day so we can count down.')
      return
    }
    setBusy(true)
    setError('')
    const fillQty = num(fill)
    const patch = {
      pills_on_hand: Math.round(count),
      pills_counted_at: new Date().toISOString(),
      pills_per_day: num(perDay),
      fill_quantity: fillQty === null ? null : Math.round(fillQty),
      refill_notify_days: Math.min(60, Math.max(0, Math.round(Number(notify) || 0))),
    }
    try {
      await updateCabinetItem(item.id, patch)
      onSaved(patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    const patch = { pills_on_hand: null, pills_counted_at: null, pills_per_day: null, fill_quantity: null }
    try {
      await updateCabinetItem(item.id, patch)
      onSaved(patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setBusy(false)
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, placeholder: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <input id={id} inputMode={mode} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className={`${inputClass} mt-1`} />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Refill tracking">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-900">Refill · {name}</h3>
        <p className="mt-1 text-sm text-slate-600">Tell us how many pills you have and we count down. The PillSeek app nudges you before you run out.</p>
        <div className="mt-4 space-y-3">
          {field('refill-on-hand', 'Pills I have now', onHand, setOnHand, 'e.g. 30')}
          {field('refill-per-day', fromSchedule ? `Pills per day (from your reminder: ${Math.round(fromSchedule * 100) / 100})` : 'Pills per day', perDay, setPerDay, fromSchedule ? 'Leave blank to use the reminder' : 'e.g. 2', 'decimal')}
          <div className="grid grid-cols-2 gap-3">
            {field('refill-fill', 'Pills per refill', fill, setFill, 'e.g. 90')}
            {field('refill-notify', 'Warn me (days before)', notify, setNotify, '5')}
          </div>
          {preview && (
            <p className={`rounded-lg px-3 py-2 text-sm ${preview.level === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
              About <strong>{preview.daysLeft} days</strong> of supply. Runs out around {preview.runsOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
            </p>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {item.pills_on_hand !== null && (
            <button type="button" disabled={busy} onClick={() => void clear()} className="mr-auto text-sm font-medium text-slate-500 hover:underline">Stop tracking</button>
          )}
          {item.pills_on_hand !== null && (
            <button type="button" disabled={busy || num(fill) === null} onClick={() => void save(true)} className={secondaryBtn}>I refilled</button>
          )}
          <button type="button" disabled={busy} onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void save(false)} className={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function CabinetClient() {
  const [user, setUser] = useState<CabinetUser | null | undefined>(undefined)
  const [items, setItems] = useState<CabinetItem[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [pills, setPills] = useState<Record<string, PillInfo>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<CabinetItem | null>(null)
  const [refilling, setRefilling] = useState<CabinetItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Session bootstrap; also listens for sign-out in another tab.
  useEffect(() => {
    void currentUser().then(setUser)
    return onAuthChange((u) => setUser((prev) => (prev?.id === u?.id ? prev : u)))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, rems] = await Promise.all([listCabinet(), listReminders()])
      setItems(list)
      setReminders(rems)
      const missing = list.map((i) => i.slug).filter((s) => !pills[s])
      const results = await Promise.allSettled(missing.map(fetchPill))
      setPills((p) => {
        const next = { ...p }
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[missing[i]] = r.value
        })
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your cabinet')
    } finally {
      setLoading(false)
    }
  }, [pills])

  // Load on sign-in; honour ?add=<slug> from a pill page's "Save to my cabinet".
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    const add = params.get('add')
    const run = async () => {
      if (add) {
        try {
          await addToCabinet(user.id, add)
          setNotice('Added to your cabinet.')
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not add that pill')
        }
        window.history.replaceState(null, '', '/cabinet')
      }
      await load()
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const remindersByItem = useMemo(() => {
    const map: Record<string, Reminder> = {}
    for (const r of reminders) map[r.cabinet_item_id] = r
    return map
  }, [reminders])

  const remove = async (item: CabinetItem) => {
    if (!window.confirm(`Remove ${pills[item.slug]?.name ?? 'this pill'} from your cabinet? Its reminder is removed too.`)) return
    try {
      await removeFromCabinet(item.id)
      setItems((xs) => xs.filter((x) => x.id !== item.id))
      setReminders((rs) => rs.filter((r) => r.cabinet_item_id !== item.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove')
    }
  }

  // Distinct medicine names (two strengths of one drug count once); null until at least two are known.
  const interactions = useMemo(() => {
    const seen = new Set<string>()
    const names: string[] = []
    for (const i of items) {
      const n = pills[i.slug]?.name
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase())
        names.push(n)
      }
    }
    const pending = items.some((i) => !pills[i.slug])
    return { pending, count: names.length, href: names.length >= 2 ? `/interactions?drugs=${encodeURIComponent(names.slice(0, 10).join(','))}` : null }
  }, [items, pills])

  const doSignOut = async () => {
    await signOut()
    setUser(null)
    setItems([])
    setReminders([])
  }

  const doDeleteAccount = async () => {
    try {
      await deleteAccountData()
      await signOut()
      setUser(null)
      setItems([])
      setReminders([])
      setConfirmDelete(false)
      setNotice('Your account and cabinet have been deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account')
      setConfirmDelete(false)
    }
  }

  if (user === undefined) return <p className="py-10 text-center text-slate-500">Loading…</p>
  if (!user) {
    return (
      <div className="space-y-6">
        {notice && <p className="mx-auto max-w-md rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
        <SignIn onSignedIn={setUser} />
      </div>
    )
  }

  const upcoming = (() => {
    const now = new Date()
    const today = now.getDay()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    let best: { time: string; name: string } | null = null
    for (const r of reminders) {
      if (!r.enabled || !r.days.includes(today)) continue
      const item = items.find((i) => i.id === r.cabinet_item_id)
      const name = item ? pills[item.slug]?.name ?? 'Pill' : 'Pill'
      for (const t of r.times) {
        if (t >= hhmm && (!best || t < best.time)) best = { time: t, name }
      }
    }
    return best
  })()

  return (
    <div className="space-y-6">
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {upcoming && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Next today: <strong>{upcoming.name}</strong> at {formatTime(upcoming.time)}
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="py-10 text-center text-slate-500">Loading your cabinet…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-lg font-semibold text-slate-900">Nothing saved yet</p>
          <p className="mt-1 text-sm text-slate-600">Open any pill page and choose “Save to my cabinet”, or find one now.</p>
          <Link href="/search" className={`${primaryBtn} mt-4`}>Search pills</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const pill = pills[item.slug]
            const r = remindersByItem[item.id]
            const refill = refillStatus(item, r ?? null)
            return (
              <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex gap-4">
                  <Link href={`/pill/${encodeURIComponent(item.slug)}`} className="flex-none">
                    {pill?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pill.image} alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-xl bg-slate-100 object-cover" />
                    ) : (
                      <span className="block h-[72px] w-[72px] rounded-xl bg-slate-100" />
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/pill/${encodeURIComponent(item.slug)}`} className="text-lg font-bold text-slate-900 hover:text-emerald-700">
                      {item.nickname || pill?.name || item.slug}
                    </Link>
                    <p className="truncate text-sm text-slate-600">
                      {[pill?.strength, pill?.imprint && `Imprint ${pill.imprint}`].filter(Boolean).join(' · ') || 'Loading details…'}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {r && (
                        <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                          {r.times.map(formatTime).join(', ')} · {formatDays(r.days)}{r.dose ? ` · ${r.dose}` : ''}
                        </span>
                      )}
                      {refill && (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${refill.level === 'ok' ? 'bg-slate-100 text-slate-700' : refill.level === 'soon' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>
                          {refillLabel(refill)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEditing(item)} className={secondaryBtn}>{r ? 'Edit reminder' : 'Remind me'}</button>
                  <button type="button" onClick={() => setRefilling(item)} className={secondaryBtn}>{item.pills_on_hand === null ? 'Track refills' : 'Refill'}</button>
                  <button type="button" onClick={() => void remove(item)} className="inline-flex items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Remove</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {items.length >= 2 && (
        interactions.href ? (
          <Link href={interactions.href} className={`${secondaryBtn} w-full`}>Check interactions between these {interactions.count}</Link>
        ) : interactions.pending ? (
          <p className="text-center text-sm text-slate-500">Loading pill names for the interaction check…</p>
        ) : (
          <p className="text-center text-sm text-slate-500">Add a different medicine to check interactions.</p>
        )
      )}

      {items.length > 0 && (
        <Link href="/cabinet/doctor-sheet" className={`${secondaryBtn} w-full`}>Doctor sheet · print or share my list</Link>
      )}

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Results are informational only and not a medical identification. Always confirm with a pharmacist before taking any medication.
      </p>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Account</h2>
        <p className="mt-1 text-sm text-slate-600">Signed in as <strong>{user.email}</strong>. The PillSeek app shows this same cabinet and sends the reminders to your phone.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void doSignOut()} className={secondaryBtn}>Sign out</button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">Delete account</button>
        </div>
      </section>

      {editing && (
        <ReminderEditor
          userId={user.id}
          item={editing}
          existing={remindersByItem[editing.id] ?? null}
          onSaved={(r) => {
            setReminders((rs) => [...rs.filter((x) => x.id !== r.id && x.cabinet_item_id !== r.cabinet_item_id), r])
            setEditing(null)
          }}
          onDeleted={() => {
            setReminders((rs) => rs.filter((x) => x.cabinet_item_id !== editing.id))
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {refilling && (
        <RefillEditor
          item={refilling}
          name={pills[refilling.slug]?.name ?? refilling.slug}
          reminder={remindersByItem[refilling.id] ?? null}
          onSaved={(patch) => {
            setItems((xs) => xs.map((x) => (x.id === refilling.id ? { ...x, ...patch } : x)))
            setRefilling(null)
          }}
          onClose={() => setRefilling(null)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Delete your account?</h3>
            <p className="mt-2 text-sm text-slate-600">This permanently removes your account, cabinet and reminders from PillSeek and the app. It cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryBtn}>Cancel</button>
              <button type="button" onClick={() => void doDeleteAccount()} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">Delete everything</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
