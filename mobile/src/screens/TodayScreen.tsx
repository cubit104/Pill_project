import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import { CheckIcon, CloseIcon } from '../components/Icons'
import { PillThumb, TextBadge, titleCase } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import { useBackHandler } from '../lib/backstack'
import { hapticTick } from '../lib/native'
import { adherence, summarize, todayDoses, type DoseStatus, type TodayDose } from '../lib/today'

const STATUS_LABEL: Record<DoseStatus, string> = { taken: 'Taken', skipped: 'Skipped', missed: 'Missed', due: 'Due now', upcoming: 'Upcoming' }
const STATUS_TONE: Record<DoseStatus, 'brand' | 'neutral' | 'amber' | 'danger'> = { taken: 'brand', skipped: 'neutral', missed: 'danger', due: 'amber', upcoming: 'neutral' }

function fmt(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Every dose due today with Taken / Skip, plus a progress line. Opened from the cabinet's "Next" card. */
export default function TodayScreen() {
  const navigate = useNavigate()
  const account = useAccount()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState<string | null>(null)
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/cabinet', { replace: true }))
  useBackHandler(true, goBack)

  // Statuses drift with the clock; refresh every minute while open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const doses = useMemo(() => todayDoses(account.items, account.reminders, account.doseEvents, now), [account.items, account.reminders, account.doseEvents, now])
  const summary = useMemo(() => summarize(doses), [doses])
  const week = useMemo(() => adherence(account.items, account.reminders, account.doseEvents, now), [account.items, account.reminders, account.doseEvents, now])
  const nameOf = (d: TodayDose) => d.item.nickname || account.pills[d.item.slug]?.drug_name || titleCase(d.item.slug.replace(/-/g, ' '))

  const mark = async (d: TodayDose, status: 'taken' | 'skipped') => {
    void hapticTick()
    setBusy(d.key)
    try {
      await account.markDose(d.reminder.id, d.at, status)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save', 'error')
    } finally {
      setBusy(null)
    }
  }

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas">
      <ScreenHeader title="Today" subtitle={dateLabel} scrollRef={scrollRef} onBack={goBack} />
      <main className="screen mx-auto max-w-lg space-y-4 px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {doses.length === 0 ? (
          <Card padded={false}>
            <EmptyState art="pill" title="No doses scheduled today" body="Set a reminder on a pill in your cabinet and it shows up here with Taken and Skip buttons." action={<Button onClick={goBack}>Back to cabinet</Button>} />
          </Card>
        ) : (
          <>
            <Card tone={summary.missed > 0 ? 'warn' : 'tint'} className="text-[15px] text-body">
              <span className="font-semibold text-ink">
                {summary.taken} of {summary.total} taken
              </span>
              {summary.missed > 0 && <span> · {summary.missed} missed</span>}
              {summary.skipped > 0 && <span> · {summary.skipped} skipped</span>}
              {summary.next && (
                <span>
                  {' '}
                  · next {nameOf(summary.next)} at {fmt(summary.next.at)}
                </span>
              )}
              {week.countedDays > 0 && (
                <span className="mt-1 block text-[13px] text-muted">
                  This week: {week.goodDays} of {week.countedDays} day{week.countedDays === 1 ? '' : 's'} on time
                  {week.streak >= 2 ? ` · ${week.streak}-day streak` : ''}
                </span>
              )}
            </Card>
            <ul className="card divide-y divide-line overflow-hidden">
              {doses.map((d) => {
                const pill = account.pills[d.item.slug]
                const done = d.status === 'taken' || d.status === 'skipped'
                return (
                  <li key={d.key} className={`px-4 py-3 ${done ? 'opacity-70' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-[76px] flex-none text-[15px] font-semibold tabular-nums text-ink">{fmt(d.at)}</span>
                      <PillThumb src={pill?.images[0] ?? null} alt="" size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">{nameOf(d)}</span>
                        <span className="block truncate text-[13px] text-muted">{d.reminder.dose ?? pill?.strength ?? ''}</span>
                      </span>
                      <TextBadge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</TextBadge>
                    </div>
                    <div className="mt-2 flex gap-2 pl-[88px]">
                      {d.status !== 'taken' && (
                        <button
                          type="button"
                          disabled={busy === d.key}
                          onClick={() => void mark(d, 'taken')}
                          className="pressable inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-brand px-3 text-[13px] font-semibold text-brand-fg disabled:opacity-50"
                        >
                          <CheckIcon size={15} /> Taken
                        </button>
                      )}
                      {d.status !== 'skipped' && d.status !== 'taken' && (
                        <button
                          type="button"
                          disabled={busy === d.key}
                          onClick={() => void mark(d, 'skipped')}
                          className="pressable inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted hairline bg-surface disabled:opacity-50"
                        >
                          <CloseIcon size={15} /> Skip
                        </button>
                      )}
                      {d.status === 'taken' && (
                        <button type="button" disabled={busy === d.key} onClick={() => void mark(d, 'skipped')} className="pressable min-h-[36px] px-1 text-[13px] font-medium text-muted">
                          Undo
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="px-1 text-[13px] text-muted">A dose counts as missed an hour after its time if it is not marked. Taken and Skip also work from the notification.</p>
          </>
        )}
      </main>
    </div>
  )
}
