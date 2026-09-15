'use client'

import { useState } from 'react'
import { classText, prettyDate, type Recall } from '../lib/recalls'

/** One FDA recall: class, date, product, reason, maker, status; lot numbers expand on click. */
export default function RecallCard({ recall, showMatch = false }: { recall: Recall; showMatch?: boolean }) {
  const [open, setOpen] = useState(false)
  const ongoing = /ongoing/i.test(recall.status)
  const badge =
    recall.cls === 'I'
      ? 'bg-red-100 text-red-800 border-red-200'
      : recall.cls === 'II'
        ? 'bg-amber-100 text-amber-900 border-amber-200'
        : 'bg-slate-100 text-slate-700 border-slate-200'
  return (
    <article className={`rounded-xl border p-4 shadow-sm ${recall.cls === 'I' ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge}`}>{recall.cls ? `Class ${recall.cls}` : 'Recall'}</span>
        {showMatch && (
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${recall.exact ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            {recall.exact ? 'Your exact product' : 'Same drug, other maker'}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">{prettyDate(recall.date)}</span>
      </div>
      <p className="mt-2 text-base font-semibold leading-snug text-slate-900">{recall.product}</p>
      <p className="mt-0.5 text-sm text-slate-500">{classText(recall.cls)}</p>
      {recall.reason && (
        <p className="mt-2 text-sm text-slate-800">
          <span className="font-semibold">Why: </span>
          {recall.reason}
        </p>
      )}
      <p className="mt-1 text-sm text-slate-500">{[recall.firm, ongoing ? 'Recall still open' : recall.status].filter(Boolean).join(' · ')}</p>
      {recall.lots && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-sm font-medium text-emerald-700 hover:text-emerald-800">
          {open ? 'Hide lot numbers' : 'Show lot numbers to compare with your bottle'}
        </button>
      )}
      {open && recall.lots && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">{recall.lots}</p>}
    </article>
  )
}
