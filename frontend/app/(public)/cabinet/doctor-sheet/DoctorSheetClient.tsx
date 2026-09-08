'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { currentUser, formatTime, listCabinet, listReminders, type CabinetItem, type CabinetUser, type Reminder } from '../../../lib/cabinet'
import { refillStatus } from '../../../lib/refill'

interface PillInfo {
  name: string
  generic: string | null
  strength: string | null
  form: string | null
  imprint: string | null
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

async function fetchPill(slug: string): Promise<PillInfo> {
  const res = await fetch(`/api/pill/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`Pill ${slug} not found`)
  const raw = (await res.json()) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const name = str(raw.drug_name) ?? str(raw.medicine_name) ?? slug
  const generic = str(raw.generic_name)
  return { name, generic: generic && generic !== name ? generic : null, strength: str(raw.strength), form: str(raw.dosage_form), imprint: str(raw.imprint) }
}

function schedule(r: Reminder | undefined): string {
  if (!r) return 'As needed / no reminder set'
  const days = r.days.length === 7 ? 'every day' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? 'weekdays' : r.days.map((d) => DAY_NAMES[d]).join(', ')
  return `${r.dose ?? '1 dose'} at ${r.times.map(formatTime).join(', ')}, ${days}`
}

/** Printable medication list for a doctor or pharmacist. Uses the browser's print dialog (save as PDF). */
export default function DoctorSheetClient() {
  const [user, setUser] = useState<CabinetUser | null | undefined>(undefined)
  const [items, setItems] = useState<CabinetItem[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [pills, setPills] = useState<Record<string, PillInfo>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    void currentUser().then(setUser)
  }, [])

  useEffect(() => {
    if (!user) return
    const run = async () => {
      try {
        const [list, rems] = await Promise.all([listCabinet(), listReminders()])
        setItems(list)
        setReminders(rems)
        const results = await Promise.allSettled(list.map((i) => fetchPill(i.slug)))
        const next: Record<string, PillInfo> = {}
        results.forEach((r, i) => {
          const slug = list[i]?.slug
          if (r.status === 'fulfilled' && slug) next[slug] = r.value
        })
        setPills(next)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your cabinet')
      }
    }
    void run()
  }, [user])

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), [])

  if (user === undefined) return <p className="py-10 text-center text-slate-500">Loading…</p>
  if (!user) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-slate-700">
        <Link href="/cabinet" className="font-semibold text-emerald-700 underline">Sign in to your cabinet</Link> to see your medication list.
      </p>
    )
  }

  return (
    <div>
      <style>{`@media print { header, footer, nav, .no-print { display: none !important; } main { padding: 0 !important; } body { background: #fff; } }`}</style>
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => window.print()} className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
          Print or save as PDF
        </button>
        <Link href="/cabinet" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to cabinet</Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <h2 className="text-xl font-bold text-slate-900">My medications</h2>
        <p className="text-sm text-slate-600">{today}{user.email ? ` · ${user.email}` : ''} · prepared with PillSeek</p>
        {items.length === 0 ? (
          <p className="mt-6 text-slate-600">Your cabinet is empty. Add pills to build this list.</p>
        ) : (
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Medication</th>
                <th className="py-2 pr-3">Looks like</th>
                <th className="py-2 pr-3">Schedule</th>
                <th className="py-2 pr-3">Supply</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const pill = pills[item.slug]
                const r = reminders.find((x) => x.cabinet_item_id === item.id)
                const status = refillStatus(item, r ?? null)
                return (
                  <tr key={item.id} className="border-b border-slate-200 align-top">
                    <td className="py-2 pr-3 text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <span className="font-semibold text-slate-900">{item.nickname || pill?.name || item.slug}</span>
                      {pill?.strength && <span className="text-slate-700"> {pill.strength}</span>}
                      {pill?.generic && <div className="text-slate-600">{pill.generic}</div>}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{[pill?.form, pill?.imprint ? `imprint ${pill.imprint}` : null].filter(Boolean).join(', ') || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">{schedule(r)}</td>
                    <td className="py-2 pr-3 text-slate-700">{status ? (status.level === 'out' ? 'Out of pills' : `~${status.daysLeft} days left`) : '—'}</td>
                    <td className="py-2 whitespace-pre-wrap text-slate-700">{item.notes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="mt-6 text-xs text-slate-500">Informational only. Confirm each medicine with the patient and the pharmacy label.</p>
      </section>
    </div>
  )
}
