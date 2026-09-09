import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Share } from '@capacitor/share'
import Button from '../components/Button'
import Card from '../components/Card'
import Disclaimer from '../components/Disclaimer'
import EmptyState from '../components/EmptyState'
import { ExternalIcon } from '../components/Icons'
import { titleCase } from '../components/PillRow'
import ScreenHeader from '../components/ScreenHeader'
import { useToast } from '../components/Toast'
import { useAccount } from '../lib/account'
import type { CabinetItem, Reminder } from '../lib/cabinet'
import { useBackHandler } from '../lib/backstack'
import { hapticTick, isNative } from '../lib/native'
import { refillStatus } from '../lib/refill'
import { adherence } from '../lib/today'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return t
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function schedule(r: Reminder | undefined): string {
  if (!r) return 'As needed / no reminder set'
  const days = r.days.length === 7 ? 'every day' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? 'weekdays' : r.days.map((d) => DAY_LABELS[d]).join(', ')
  return `${r.dose ?? '1 dose'} at ${r.times.map(fmtTime).join(', ')}, ${days}`
}

interface Row {
  item: CabinetItem
  name: string
  generic: string | null
  strength: string | null
  form: string | null
  imprint: string | null
  schedule: string
  supply: string | null
}

/**
 * One page a person can hand to a doctor or pharmacist: everything in the
 * cabinet with strength, imprint, schedule and supply. Shared as plain text
 * through the system share sheet (Messages, Mail, Notes, AirDrop, print…).
 */
export default function DoctorSheetScreen() {
  const navigate = useNavigate()
  const account = useAccount()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/cabinet', { replace: true }))
  useBackHandler(true, goBack)

  const rows = useMemo<Row[]>(
    () =>
      account.items.map((item) => {
        const pill = account.pills[item.slug]
        const reminder = account.reminders.find((r) => r.cabinet_item_id === item.id)
        const status = refillStatus(item, reminder ?? null)
        return {
          item,
          name: item.nickname || pill?.drug_name || titleCase(item.slug.replace(/-/g, ' ')),
          generic: pill?.generic_name && pill.generic_name !== pill.drug_name ? pill.generic_name : null,
          strength: pill?.strength ?? null,
          form: pill?.dosage_form ?? null,
          imprint: pill?.imprint ?? null,
          schedule: schedule(reminder),
          supply: status ? (status.level === 'out' ? 'out of pills' : `about ${status.daysLeft} days left`) : null,
        }
      }),
    [account.items, account.pills, account.reminders],
  )

  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const week = useMemo(() => adherence(account.items, account.reminders, account.doseEvents), [account.items, account.reminders, account.doseEvents])

  const asText = () => {
    const lines = [`My medications — ${today}`, account.user?.email ? `Prepared with PillSeek for ${account.user.email}` : 'Prepared with PillSeek', '']
    rows.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.name}${r.generic ? ` (${r.generic})` : ''}${r.strength ? ` ${r.strength}` : ''}`)
      const id = [r.form, r.imprint ? `imprint ${r.imprint}` : null].filter(Boolean).join(', ')
      if (id) lines.push(`   ${id}`)
      lines.push(`   Schedule: ${r.schedule}`)
      if (r.supply) lines.push(`   Supply: ${r.supply}`)
      if (r.item.notes) lines.push(`   Notes: ${r.item.notes}`)
      lines.push('')
    })
    if (week.countedDays > 0) lines.push(`Adherence (last 7 days): ${week.goodDays} of ${week.countedDays} days with every dose taken.`, '')
    lines.push('Informational only; confirm each medicine with the patient and the pharmacy label.')
    return lines.join('\n')
  }

  const share = async () => {
    void hapticTick()
    setBusy(true)
    const text = asText()
    try {
      if (isNative()) {
        await Share.share({ title: `My medications — ${today}`, text, dialogTitle: 'Share medication list' })
      } else if (navigator.share) {
        await navigator.share({ title: `My medications — ${today}`, text })
      } else {
        await navigator.clipboard.writeText(text)
        toast.show('Copied to clipboard', 'success')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!/cancel/i.test(msg)) toast.show('Could not share', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas">
      <ScreenHeader title="Doctor sheet" subtitle={today} scrollRef={scrollRef} onBack={goBack} />
      <main className="screen mx-auto max-w-lg space-y-4 px-4 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {rows.length === 0 ? (
          <Card padded={false}>
            <EmptyState art="pill" title="Nothing to list yet" body="Add the pills you take to your cabinet and they appear here, ready to show your doctor or pharmacist." action={<Button onClick={goBack}>Back to cabinet</Button>} />
          </Card>
        ) : (
          <>
            <p className="px-1 text-[14px] text-muted">Everything in your cabinet, in one list to show or send to your doctor or pharmacist.</p>
            <ol className="card divide-y divide-line overflow-hidden">
              {rows.map((r, i) => (
                <li key={r.item.id} className="px-4 py-3">
                  <p className="text-[17px] font-semibold text-ink">
                    {i + 1}. {r.name}
                    {r.strength && <span className="font-medium text-body"> · {r.strength}</span>}
                  </p>
                  {r.generic && <p className="text-[14px] text-muted">{r.generic}</p>}
                  <dl className="mt-1.5 space-y-0.5 text-[14px] text-body">
                    {(r.form || r.imprint) && (
                      <div className="flex gap-2">
                        <dt className="w-20 flex-none text-muted">Looks like</dt>
                        <dd>{[r.form, r.imprint ? `imprint ${r.imprint}` : null].filter(Boolean).join(', ')}</dd>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <dt className="w-20 flex-none text-muted">Schedule</dt>
                      <dd>{r.schedule}</dd>
                    </div>
                    {r.supply && (
                      <div className="flex gap-2">
                        <dt className="w-20 flex-none text-muted">Supply</dt>
                        <dd>{r.supply}</dd>
                      </div>
                    )}
                    {r.item.notes && (
                      <div className="flex gap-2">
                        <dt className="w-20 flex-none text-muted">Notes</dt>
                        <dd className="whitespace-pre-wrap">{r.item.notes}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
            {week.countedDays > 0 && (
              <p className="px-1 text-[14px] text-body">
                Adherence, last 7 days: <span className="font-semibold text-ink">{week.goodDays} of {week.countedDays} days</span> with every dose taken
                {week.streak >= 2 ? ` · ${week.streak}-day streak` : ''}.
              </p>
            )}
            <Button full loading={busy} icon={<ExternalIcon size={18} />} onClick={() => void share()}>
              Share or print
            </Button>
            <Disclaimer compact />
          </>
        )}
      </main>
    </div>
  )
}
