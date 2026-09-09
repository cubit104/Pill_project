import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import { BellIcon, CabinetIcon, ChevronRightIcon, ClockIcon, InteractionsIcon, PillIcon, RxIcon, TrashIcon, UserIcon } from '../components/Icons'
import { PillThumb, TextBadge, titleCase } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import Sheet from '../components/Sheet'
import { Skeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import type { CabinetItem, Reminder } from '../lib/cabinet'
import { interactionsPath } from '../lib/interactions'
import { hapticTick } from '../lib/native'
import { effectiveRate, refillLabel, refillStatus, scheduleRate } from '../lib/refill'
import { ensureNotificationPermission, upcomingDoses } from '../lib/reminders'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const PRESET_TIMES = [
  { label: 'Morning', time: '08:00' },
  { label: 'Noon', time: '12:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Bedtime', time: '22:00' },
]

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return t
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function describe(r: Reminder): string {
  const days = r.days.length === 7 ? 'Every day' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? 'Weekdays' : r.days.map((d) => DAY_LABELS[d]).join(' ')
  return `${r.times.map(fmtTime).join(', ')} · ${days}`
}

/** Reminder editor (create or edit) for one cabinet item. */
function ReminderSheet({ item, name, existing, onClose }: { item: CabinetItem; name: string; existing: Reminder | null; onClose: () => void }) {
  const account = useAccount()
  const toast = useToast()
  const [times, setTimes] = useState<string[]>(existing?.times ?? ['08:00'])
  const [days, setDays] = useState<number[]>(existing?.days ?? [0, 1, 2, 3, 4, 5, 6])
  const [dose, setDose] = useState(existing?.dose ?? '1 tablet')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState('')

  const toggleTime = (t: string) => setTimes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t].sort()))
  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  /** The phone's own time wheel (AM/PM, no keyboard); picking a time adds it as a chip. */
  const addPicked = (value: string) => {
    if (/^\d{2}:\d{2}$/.test(value)) setTimes((prev) => (prev.includes(value) ? prev : [...prev, value].sort()))
  }

  const save = async () => {
    if (times.length === 0 || days.length === 0) return
    void hapticTick()
    setBusy(true)
    try {
      const granted = await ensureNotificationPermission()
      await account.upsertReminder({
        id: existing?.id,
        cabinet_item_id: item.id,
        times,
        days,
        dose: dose.trim() || null,
        enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      })
      toast.show(granted ? 'Reminder set' : 'Reminder saved. Turn on notifications in Settings to be alerted.', granted ? 'success' : 'error')
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Remind me · ${name}`}>
      <div className="space-y-4">
        <div>
          <SectionLabel>Times</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {PRESET_TIMES.map((p) => (
              <Chip key={p.time} selected={times.includes(p.time)} onClick={() => toggleTime(p.time)}>
                {p.label} {fmtTime(p.time)}
              </Chip>
            ))}
            {times
              .filter((t) => !PRESET_TIMES.some((p) => p.time === t))
              .map((t) => (
                <Chip key={t} selected onClick={() => toggleTime(t)}>
                  {fmtTime(t)}
                </Chip>
              ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="flex h-12 flex-1 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 text-[15px] text-body">
              <span>Other time</span>
              <input
                type="time"
                aria-label="Pick another time"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="h-9 rounded-lg bg-transparent px-2 text-[17px] font-semibold text-brand"
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={!/^\d{2}:\d{2}$/.test(picked)}
              onClick={() => {
                addPicked(picked)
                setPicked('')
              }}
            >
              Add
            </Button>
          </div>
          <p className="mt-1 px-1 text-[12px] text-muted">Tap a time to remove it.</p>
        </div>
        <div>
          <SectionLabel>Days</SectionLabel>
          <div className="flex gap-1.5" role="group" aria-label="Days of the week">
            {DAY_LABELS.map((l, d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(d)}
                onClick={() => toggleDay(d)}
                className={`pressable h-10 flex-1 rounded-full text-[15px] font-semibold ${days.includes(d) ? 'bg-brand text-brand-fg' : 'hairline bg-surface text-body'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <TextField label="Dose" value={dose} onChange={setDose} placeholder="e.g. 1 tablet" autoCapitalize="none" />
        <div className="flex gap-2">
          {existing && (
            <Button
              variant="danger"
              onClick={() => {
                void hapticTick()
                void account.removeReminder(existing.id).then(onClose)
              }}
            >
              Remove
            </Button>
          )}
          <Button full loading={busy} disabled={times.length === 0 || days.length === 0} onClick={() => void save()}>
            {existing ? 'Save' : 'Set reminder'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Pill count + rate; days-left and the refill nudge follow from these. */
function RefillSheet({ item, name, reminder, onClose }: { item: CabinetItem; name: string; reminder: Reminder | null; onClose: () => void }) {
  const account = useAccount()
  const toast = useToast()
  const fromSchedule = scheduleRate(reminder)
  const [onHand, setOnHand] = useState(item.pills_on_hand === null ? '' : String(item.pills_on_hand))
  const [perDay, setPerDay] = useState(item.pills_per_day === null ? '' : String(item.pills_per_day))
  const [fill, setFill] = useState(item.fill_quantity === null ? '' : String(item.fill_quantity))
  const [notify, setNotify] = useState(String(item.refill_notify_days))
  const [busy, setBusy] = useState(false)

  const num = (v: string) => {
    const n = Number(v.trim())
    return v.trim() === '' || !Number.isFinite(n) ? null : n
  }
  const preview = refillStatus(
    { pills_on_hand: num(onHand), pills_counted_at: null, pills_per_day: num(perDay), fill_quantity: num(fill), refill_notify_days: Number(notify) || 0 },
    reminder,
  )

  const save = async (refilled = false) => {
    void hapticTick()
    const count = refilled ? num(fill) : num(onHand)
    if (count === null || !Number.isFinite(count) || count < 0) {
      toast.show(refilled ? 'Enter how many pills a refill gives you' : 'Enter how many pills you have', 'error')
      return
    }
    if (!effectiveRate({ pills_per_day: num(perDay) }, reminder)) {
      toast.show('Set a reminder or enter pills per day so we can count down', 'error')
      return
    }
    setBusy(true)
    try {
      const fillQty = num(fill)
      await account.update(item.id, {
        pills_on_hand: Math.round(count),
        pills_counted_at: new Date().toISOString(),
        pills_per_day: num(perDay),
        fill_quantity: fillQty === null ? null : Math.round(fillQty),
        refill_notify_days: Math.min(60, Math.max(0, Math.round(Number(notify) || 0))),
      })
      toast.show(refilled ? 'Count reset to a full refill' : 'Refill tracking saved', 'success')
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save', 'error')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      await account.update(item.id, { pills_on_hand: null, pills_counted_at: null, pills_per_day: null, fill_quantity: null })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Refill · ${name}`}>
      <div className="space-y-4">
        <TextField label="Pills I have now" value={onHand} onChange={setOnHand} inputMode="numeric" placeholder="e.g. 30" />
        <TextField
          label={fromSchedule ? `Pills per day (from your reminder: ${Math.round(fromSchedule * 100) / 100})` : 'Pills per day'}
          value={perDay}
          onChange={setPerDay}
          inputMode="decimal"
          placeholder={fromSchedule ? 'Leave blank to use the reminder' : 'e.g. 2'}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Pills per refill" value={fill} onChange={setFill} inputMode="numeric" placeholder="e.g. 90" />
          <TextField label="Warn me (days before)" value={notify} onChange={setNotify} inputMode="numeric" placeholder="5" />
        </div>
        {preview && (
          <Card tone={preview.level === 'ok' ? 'tint' : 'warn'} className="text-[14px] text-body">
            About <span className="font-semibold text-ink">{preview.daysLeft} days</span> of supply. Runs out around{' '}
            {preview.runsOut.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}; we nudge you{' '}
            {preview.notifyAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.
          </Card>
        )}
        <div className="flex gap-2">
          {item.pills_on_hand !== null && (
            <Button variant="secondary" onClick={() => void save(true)} disabled={busy || num(fill) === null}>
              I refilled
            </Button>
          )}
          <Button full loading={busy} onClick={() => void save(false)}>
            Save
          </Button>
        </div>
        {item.pills_on_hand !== null && (
          <button type="button" onClick={() => void clear()} className="pressable w-full py-1 text-[14px] font-medium text-muted">
            Stop tracking refills for this pill
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** The user's saved pills with reminders, and one-tap tools that use the whole list. */
export default function CabinetScreen({ active = true }: { active?: boolean }) {
  void active
  const navigate = useNavigate()
  const account = useAccount()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<{ item: CabinetItem; reminder: Reminder | null } | null>(null)
  const [removing, setRemoving] = useState<CabinetItem | null>(null)
  const [refilling, setRefilling] = useState<{ item: CabinetItem; reminder: Reminder | null } | null>(null)

  const nextDose = useMemo(() => {
    const now = new Date()
    let best: { at: Date; item: CabinetItem; reminder: Reminder } | null = null
    for (const r of account.reminders) {
      const item = account.items.find((i) => i.id === r.cabinet_item_id)
      if (!item) continue
      const at = upcomingDoses(r, now, 2)[0]
      if (at && (!best || at < best.at)) best = { at, item, reminder: r }
    }
    return best
  }, [account.reminders, account.items])

  const nameOf = (item: CabinetItem) => item.nickname || account.pills[item.slug]?.drug_name || titleCase(item.slug.replace(/-/g, ' '))

  const checkInteractions = () => {
    const names = account.items.map((i) => account.pills[i.slug]?.generic_name ?? account.pills[i.slug]?.drug_name ?? nameOf(i))
    if (names.length < 2) {
      toast.show('Add at least two medicines to check interactions')
      return
    }
    void hapticTick()
    navigate(interactionsPath(...names))
  }

  let body: React.ReactNode
  if (!account.enabled) {
    body = (
      <Card tone="warn" className="text-[15px] text-body">
        Accounts are not available in this build.
      </Card>
    )
  } else if (!account.ready) {
    body = (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-24 w-full rounded-card" />
      </div>
    )
  } else if (!account.user) {
    body = (
      <Card padded={false}>
        <EmptyState
          art="pill"
          title="Your medicine cabinet"
          body="Save the pills you take, set reminders, and check them for interactions. Sign in with your email to keep it on every device."
          action={
            <Button icon={<UserIcon size={18} />} onClick={() => navigate('/account')}>
              Sign in
            </Button>
          }
        />
      </Card>
    )
  } else if (account.loading && account.items.length === 0) {
    body = (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-24 w-full rounded-card" />
      </div>
    )
  } else if (account.items.length === 0) {
    body = (
      <Card padded={false}>
        <EmptyState
          art="search"
          title="Nothing saved yet"
          body="Open any pill and tap “Add to my cabinet”, or identify one with the camera."
          action={<Button onClick={() => navigate('/identify')}>Identify a pill</Button>}
        />
      </Card>
    )
  } else {
    body = (
      <div className="space-y-4">
        {nextDose && (
          <Card tone="tint" className="flex items-center gap-3">
            <BellIcon size={22} className="flex-none text-brand" />
            <span className="min-w-0 flex-1 text-[14px] text-body">
              Next: <span className="font-semibold text-ink">{nameOf(nextDose.item)}</span> at{' '}
              {nextDose.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              {nextDose.at.getDate() !== new Date().getDate() ? ' tomorrow' : ''}
            </span>
          </Card>
        )}
        <div className="card divide-y divide-line overflow-hidden">
          {account.items.map((item) => {
            const pill = account.pills[item.slug]
            const rems = account.reminders.filter((r) => r.cabinet_item_id === item.id)
            const refill = refillStatus(item, rems[0] ?? null)
            return (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => navigate(`/pill/${encodeURIComponent(item.slug)}`)} className="pressable flex min-w-0 flex-1 items-center gap-3 text-left">
                    <PillThumb src={pill?.images[0] ?? null} alt="" size={52} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] font-semibold text-ink">{nameOf(item)}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {pill ? [pill.strength, pill.imprint ? `Imprint ${pill.imprint}` : null].filter(Boolean).join(' · ') : 'Loading…'}
                      </span>
                      {(rems.length > 0 || refill) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {rems.map((r) => (
                            <TextBadge key={r.id} tone={r.enabled ? 'brand' : 'neutral'}>
                              {describe(r)}
                            </TextBadge>
                          ))}
                          {refill && <TextBadge tone={refill.level === 'ok' ? 'neutral' : refill.level === 'soon' ? 'amber' : 'danger'}>{refillLabel(refill)}</TextBadge>}
                        </span>
                      )}
                    </span>
                    <ChevronRightIcon size={18} className="flex-none text-muted" />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTick()
                      setEditing({ item, reminder: rems[0] ?? null })
                    }}
                    className="pressable inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-brand-tint px-3 text-[13px] font-semibold text-brand"
                  >
                    <BellIcon size={15} /> {rems.length ? 'Edit reminder' : 'Remind me'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTick()
                      setRefilling({ item, reminder: rems[0] ?? null })
                    }}
                    className={`pressable inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${refill && refill.level !== 'ok' ? 'bg-amber-100 text-amber-800' : 'bg-brand-tint text-brand'}`}
                  >
                    <PillIcon size={15} /> {item.pills_on_hand === null ? 'Track refills' : 'Refill'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(item)}
                    className="pressable inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted"
                  >
                    <TrashIcon size={15} /> Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <Button full variant="secondary" icon={<InteractionsIcon size={18} />} onClick={checkInteractions}>
          Check interactions between these {account.items.length}
        </Button>
        <Button
          full
          variant="secondary"
          icon={<RxIcon size={18} />}
          onClick={() => {
            void hapticTick()
            navigate('/doctor-sheet')
          }}
        >
          Doctor sheet · share my list
        </Button>
        <Disclaimer compact />
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ScreenHeader
        title="My cabinet"
        scrollRef={scrollRef}
        trailing={
          account.enabled ? (
            <button type="button" onClick={() => navigate('/account')} aria-label="Account" className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand">
              <UserIcon size={20} />
            </button>
          ) : undefined
        }
      />
      <main className="screen mx-auto max-w-lg space-y-4 px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {account.error && (
          <Card tone="danger" className="text-[14px] text-body">
            {account.error}
          </Card>
        )}
        {body}
        <button
          type="button"
          onClick={() => navigate('/recent')}
          className="pressable flex w-full items-center justify-between rounded-card px-4 py-3 text-[15px] font-medium text-body hairline bg-surface active:bg-brand-tint"
        >
          <span className="inline-flex items-center gap-2">
            <ClockIcon size={18} className="text-muted" /> Recent identifications and searches
          </span>
          <ChevronRightIcon size={18} className="text-muted" />
        </button>
      </main>

      {editing && <ReminderSheet item={editing.item} name={nameOf(editing.item)} existing={editing.reminder} onClose={() => setEditing(null)} />}
      {refilling && <RefillSheet item={refilling.item} name={nameOf(refilling.item)} reminder={refilling.reminder} onClose={() => setRefilling(null)} />}

      <Sheet open={removing !== null} onClose={() => setRemoving(null)} title="Remove from cabinet?">
        {removing && (
          <div className="space-y-3">
            <p className="text-[15px] text-body">
              <span className="font-semibold text-ink">{nameOf(removing)}</span> and its reminders will be removed from your cabinet.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                icon={<TrashIcon size={16} />}
                onClick={() => {
                  void hapticTick()
                  void account.remove(removing.id).then(() => setRemoving(null))
                }}
              >
                Remove
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Keep
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <span className="hidden">
        <CabinetIcon size={1} />
      </span>
    </div>
  )
}
