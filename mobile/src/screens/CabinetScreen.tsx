import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card, { SectionLabel } from '../components/Card'
import Chip from '../components/Chip'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import ItemSheet from '../components/ItemSheet'
import { BellIcon, CabinetIcon, CameraIcon, ChevronRightIcon, ClockIcon, InteractionsIcon, PillIcon, RxIcon, TrashIcon, UserIcon } from '../components/Icons'
import { PillThumb, TextBadge, titleCase } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import Sheet from '../components/Sheet'
import { Skeleton } from '../components/Skeleton'
import TextField from '../components/TextField'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import type { CabinetItem, Reminder } from '../lib/cabinet'
import { useLocale, useT } from '../lib/i18n'
import { interactionsPath } from '../lib/interactions'
import { hapticTick } from '../lib/native'
import { ocrAvailable } from '../lib/ocr'
import { effectiveRate, refillStatus, scheduleRate, type RefillStatus } from '../lib/refill'
import { ensureNotificationPermission, upcomingDoses } from '../lib/reminders'
import { summarize, todayDoses } from '../lib/today'

type T = ReturnType<typeof useT>

const PRESET_TIMES = [
  { label: 'Morning', time: '08:00' },
  { label: 'Noon', time: '12:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Bedtime', time: '22:00' },
]

/** Text field with a visible caption (the placeholder alone disappears once you type). */
function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-1 text-[13px] font-semibold text-body">
        {label}
        {hint && <span className="font-normal text-muted"> · {hint}</span>}
      </p>
      {children}
    </div>
  )
}

function fmtTime(time: string, locale: string): string {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return time
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

function describe(r: Reminder, t: T, locale: string): string {
  const dayLetters = t('S M T W T F S').split(' ')
  const days = r.days.length === 7 ? t('Every day') : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? t('Weekdays') : r.days.map((d) => dayLetters[d]).join(' ')
  return `${r.times.map((x) => fmtTime(x, locale)).join(', ')} · ${days}`
}

/** Same wording as lib/refill's refillLabel, but through the translator. */
function refillText(s: RefillStatus, t: T): string {
  if (s.level === 'out') return t('Out of pills')
  if (s.level === 'soon') return s.daysLeft === 0 ? t('Refill today') : s.daysLeft === 1 ? t('Refill soon · 1 day left') : t('Refill soon · {n} days left', { n: s.daysLeft })
  return t('{n} days left', { n: s.daysLeft })
}

/** Reminder editor (create or edit) for one cabinet item. */
function ReminderSheet({ item, name, existing, onClose }: { item: CabinetItem; name: string; existing: Reminder | null; onClose: () => void }) {
  const t = useT()
  const locale = useLocale()
  const account = useAccount()
  const toast = useToast()
  const [times, setTimes] = useState<string[]>(existing?.times ?? ['08:00'])
  const [days, setDays] = useState<number[]>(existing?.days ?? [0, 1, 2, 3, 4, 5, 6])
  const [dose, setDose] = useState(existing?.dose ?? t('1 tablet'))
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState('')
  const dayLetters = t('S M T W T F S').split(' ')

  const toggleTime = (time: string) => setTimes((prev) => (prev.includes(time) ? prev.filter((x) => x !== time) : [...prev, time].sort()))
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
      toast.show(granted ? t('Reminder set') : t('Reminder saved. Turn on notifications in Settings to be alerted.'), granted ? 'success' : 'error')
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t('Could not save'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('Remind me · {name}', { name })}>
      <div className="space-y-4">
        <div>
          <SectionLabel>{t('Times')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {PRESET_TIMES.map((p) => (
              <Chip key={p.time} selected={times.includes(p.time)} onClick={() => toggleTime(p.time)}>
                {t(p.label)} {fmtTime(p.time, locale)}
              </Chip>
            ))}
            {times
              .filter((time) => !PRESET_TIMES.some((p) => p.time === time))
              .map((time) => (
                <Chip key={time} selected onClick={() => toggleTime(time)}>
                  {fmtTime(time, locale)}
                </Chip>
              ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="flex h-12 flex-1 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 text-[15px] text-body">
              <span>{t('Other time')}</span>
              <input
                type="time"
                aria-label={t('Pick another time')}
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
              {t('Add')}
            </Button>
          </div>
          <p className="mt-1 px-1 text-[12px] text-muted">{t('Tap a time to remove it.')}</p>
        </div>
        <div>
          <SectionLabel>{t('Days')}</SectionLabel>
          <div className="flex gap-1.5" role="group" aria-label={t('Days of the week')}>
            {dayLetters.map((l, d) => (
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
        <Labeled label={t('Dose')}>
          <TextField label={t('Dose')} value={dose} onChange={setDose} placeholder={t('e.g. 1 tablet')} autoCapitalize="none" />
        </Labeled>
        <div className="flex gap-2">
          {existing && (
            <Button
              variant="danger"
              onClick={() => {
                void hapticTick()
                void account.removeReminder(existing.id).then(onClose)
              }}
            >
              {t('Remove')}
            </Button>
          )}
          <Button full loading={busy} disabled={times.length === 0 || days.length === 0} onClick={() => void save()}>
            {existing ? t('Save') : t('Set reminder')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Pill count + rate; days-left and the refill nudge follow from these. */
function RefillSheet({ item, name, reminder, onClose }: { item: CabinetItem; name: string; reminder: Reminder | null; onClose: () => void }) {
  const t = useT()
  const locale = useLocale()
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
      toast.show(refilled ? t('Enter how many pills a refill gives you') : t('Enter how many pills you have'), 'error')
      return
    }
    if (!effectiveRate({ pills_per_day: num(perDay) }, reminder)) {
      toast.show(t('Set a reminder or enter pills per day so we can count down'), 'error')
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
      toast.show(refilled ? t('Count reset to a full refill') : t('Refill tracking saved'), 'success')
      onClose()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t('Could not save'), 'error')
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
    <Sheet open onClose={onClose} title={t('Refill · {name}', { name })}>
      <div className="space-y-4">
        <Labeled label={t('Pills I have now')}>
          <TextField label={t('Pills I have now')} value={onHand} onChange={setOnHand} inputMode="numeric" placeholder={t('e.g. 30')} />
        </Labeled>
        <Labeled label={t('Pills per day')} hint={fromSchedule ? t('from your reminder: {rate}', { rate: Math.round(fromSchedule * 100) / 100 }) : undefined}>
          <TextField
            label={t('Pills per day')}
            value={perDay}
            onChange={setPerDay}
            inputMode="decimal"
            placeholder={fromSchedule ? t('Leave blank to use the reminder') : t('e.g. 2')}
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t('Pills per refill')}>
            <TextField label={t('Pills per refill')} value={fill} onChange={setFill} inputMode="numeric" placeholder={t('e.g. 90')} />
          </Labeled>
          <Labeled label={t('Warn me (days before)')}>
            <TextField label={t('Warn me (days before)')} value={notify} onChange={setNotify} inputMode="numeric" placeholder="5" />
          </Labeled>
        </div>
        {preview && (
          <Card tone={preview.level === 'ok' ? 'tint' : 'warn'} className="text-[14px] text-body">
            <span className="font-semibold text-ink">{t('About {n} days of supply.', { n: preview.daysLeft })}</span>{' '}
            {t('Runs out around {date}; we nudge you {notify}.', {
              date: preview.runsOut.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
              notify: preview.notifyAt.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
            })}
          </Card>
        )}
        <div className="flex gap-2">
          {item.pills_on_hand !== null && (
            <Button variant="secondary" onClick={() => void save(true)} disabled={busy || num(fill) === null}>
              {t('I refilled')}
            </Button>
          )}
          <Button full loading={busy} onClick={() => void save(false)}>
            {t('Save')}
          </Button>
        </div>
        {item.pills_on_hand !== null && (
          <button type="button" onClick={() => void clear()} className="pressable w-full py-1 text-[14px] font-medium text-muted">
            {t('Stop tracking refills for this pill')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** The user's saved pills with reminders, and one-tap tools that use the whole list. */
export default function CabinetScreen({ active = true }: { active?: boolean }) {
  void active
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const account = useAccount()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<{ item: CabinetItem; reminder: Reminder | null } | null>(null)
  const [removing, setRemoving] = useState<CabinetItem | null>(null)
  const [refilling, setRefilling] = useState<{ item: CabinetItem; reminder: Reminder | null } | null>(null)
  const [details, setDetails] = useState<CabinetItem | null>(null)

  const today = useMemo(() => summarize(todayDoses(account.items, account.reminders, account.doseEvents)), [account.items, account.reminders, account.doseEvents])

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
      toast.show(t('Add at least two medicines to check interactions'))
      return
    }
    void hapticTick()
    navigate(interactionsPath(...names))
  }

  let body: React.ReactNode
  if (!account.enabled) {
    body = (
      <Card tone="warn" className="text-[15px] text-body">
        {t('Accounts are not available in this build.')}
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
          title={t('Your medicine cabinet')}
          body={t('Save the pills you take, set reminders, and check them for interactions. Sign in with your email to keep it on every device.')}
          action={
            <Button icon={<UserIcon size={18} />} onClick={() => navigate('/account')}>
              {t('Sign in')}
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
          title={t('Nothing saved yet')}
          body={t('Scan the label on a pharmacy bottle, open any pill and tap “Add to my cabinet”, or identify one with the camera.')}
          action={
            <div className="flex flex-col gap-2">
              {ocrAvailable() && (
                <Button icon={<CameraIcon size={18} />} onClick={() => navigate('/scan-bottle')}>
                  {t('Scan a pharmacy bottle')}
                </Button>
              )}
              <Button variant={ocrAvailable() ? 'secondary' : 'primary'} onClick={() => navigate('/identify')}>
                {t('Identify a pill')}
              </Button>
            </div>
          }
        />
      </Card>
    )
  } else {
    body = (
      <div className="space-y-4">
        {ocrAvailable() && (
          <button
            type="button"
            onClick={() => {
              void hapticTick()
              navigate('/scan-bottle')
            }}
            className="pressable flex w-full items-center gap-3 rounded-card border border-dashed border-brand/50 bg-surface px-4 py-3 text-left"
          >
            <CameraIcon size={22} className="flex-none text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">{t('Scan a pharmacy bottle')}</span>
              <span className="block text-[13px] text-muted">{t('Adds the pill, reminders, Rx and refill count from the label')}</span>
            </span>
            <ChevronRightIcon size={18} className="flex-none text-muted" />
          </button>
        )}
        {account.notifications === 'denied' && account.reminders.length > 0 && (
          <Card tone="warn" className="text-[14px] text-body">
            <span className="font-semibold text-ink">{t('Notifications are off')}</span>
            {t(', so reminders will not ring. Turn them on in iPhone Settings → Notifications → PillSeek, then reopen the app.')}
          </Card>
        )}
        {(nextDose || today.total > 0) && (
          <button
            type="button"
            onClick={() => {
              void hapticTick()
              navigate('/today')
            }}
            className={`pressable flex w-full items-center gap-3 rounded-card p-4 text-left ${today.missed > 0 ? 'bg-amber-50' : 'bg-brand-tint'}`}
          >
            <BellIcon size={22} className={`flex-none ${today.missed > 0 ? 'text-amber-700' : 'text-brand'}`} />
            <span className="min-w-0 flex-1 text-[14px] text-body">
              {nextDose && (
                <span className="block">
                  {t('Next:')} <span className="font-semibold text-ink">{nameOf(nextDose.item)}</span>{' '}
                  {t('at {time}', { time: nextDose.at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) })}
                  {nextDose.at.getDate() !== new Date().getDate() ? ` ${t('tomorrow')}` : ''}
                </span>
              )}
              {today.total > 0 && (
                <span className="block text-[13px] text-muted">
                  {t('Today: {taken} of {total} taken', { taken: today.taken, total: today.total })}
                  {today.missed > 0 && <span className="font-semibold text-amber-800"> · {t('{n} missed', { n: today.missed })}</span>}
                </span>
              )}
            </span>
            <ChevronRightIcon size={18} className="flex-none text-muted" />
          </button>
        )}
        <div className="card divide-y divide-line overflow-hidden">
          {account.items.map((item) => {
            const pill = account.pills[item.slug]
            const rems = account.reminders.filter((r) => r.cabinet_item_id === item.id)
            const refill = refillStatus(item, rems[0] ?? null)
            return (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTick()
                      setDetails(item)
                    }}
                    className="pressable flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <PillThumb src={pill?.images[0] ?? null} alt="" size={52} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[18px] font-semibold text-ink">{nameOf(item)}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {pill ? [pill.strength, pill.imprint ? t('Imprint {imprint}', { imprint: pill.imprint }) : null].filter(Boolean).join(' · ') : t('Loading…')}
                      </span>
                      {item.directions && <span className="block truncate text-[13px] text-body">{item.directions}</span>}
                      {(rems.length > 0 || refill) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {rems.map((r) => (
                            <TextBadge key={r.id} tone={r.enabled ? 'brand' : 'neutral'}>
                              {describe(r, t, locale)}
                            </TextBadge>
                          ))}
                          {refill && <TextBadge tone={refill.level === 'ok' ? 'neutral' : refill.level === 'soon' ? 'amber' : 'danger'}>{refillText(refill, t)}</TextBadge>}
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
                    <BellIcon size={15} /> {rems.length ? t('Reminder') : t('Remind me')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTick()
                      setRefilling({ item, reminder: rems[0] ?? null })
                    }}
                    className={`pressable inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${refill && refill.level !== 'ok' ? 'bg-amber-100 text-amber-800' : 'bg-brand-tint text-brand'}`}
                  >
                    <PillIcon size={15} /> {t('Refill')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <Button full variant="secondary" icon={<InteractionsIcon size={18} />} onClick={checkInteractions}>
          {t('Check interactions between these {n}', { n: account.items.length })}
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
          {t('Doctor sheet · share my list')}
        </Button>
        <Disclaimer compact />
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <ScreenHeader
        title={t('My cabinet')}
        scrollRef={scrollRef}
        trailing={
          account.enabled ? (
            <button type="button" onClick={() => navigate('/account')} aria-label={t('Account')} className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand">
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
            <ClockIcon size={18} className="text-muted" /> {t('Recent identifications and searches')}
          </span>
          <ChevronRightIcon size={18} className="text-muted" />
        </button>
      </main>

      {editing && <ReminderSheet item={editing.item} name={nameOf(editing.item)} existing={editing.reminder} onClose={() => setEditing(null)} />}
      {refilling && <RefillSheet item={refilling.item} name={nameOf(refilling.item)} reminder={refilling.reminder} onClose={() => setRefilling(null)} />}
      {details && (
        <ItemSheet
          item={details}
          name={nameOf(details)}
          image={account.pills[details.slug]?.images[0] ?? null}
          onClose={() => setDetails(null)}
          onRemove={() => {
            setDetails(null)
            setRemoving(details)
          }}
        />
      )}

      <Sheet open={removing !== null} onClose={() => setRemoving(null)} title={t('Remove from cabinet?')}>
        {removing && (
          <div className="space-y-3">
            <p className="text-[15px] text-body">
              <span className="font-semibold text-ink">{nameOf(removing)}</span> {t('and its reminders will be removed from your cabinet.')}
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
                {t('Remove')}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                {t('Keep')}
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
