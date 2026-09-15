'use client'

import Link from 'next/link'
import { useState } from 'react'
import RecallCard from '../../../components/RecallCard'
import type { Recall } from '../../../lib/recalls'

const SHOW = 3

/**
 * "Recalls and safety alerts" on a pill page: FDA recalls for this drug in the
 * last 12 months, fetched on the server (see page.tsx) and rendered here so the
 * first few are in the HTML; more expand on click.
 */
export default function RecallsSection({ recalls, drugName }: { recalls: Recall[]; drugName: string }) {
  const [all, setAll] = useState(false)
  const name = drugName && drugName !== 'Unknown' ? drugName : 'this medication'
  const shown = all ? recalls : recalls.slice(0, SHOW)
  const exact = recalls.filter((r) => r.exact).length
  return (
    <section className={`rounded-xl border shadow-sm p-6 mb-6 ${recalls.length > 0 ? 'bg-white border-amber-200' : 'bg-white border-emerald-200'}`} aria-labelledby="recalls-heading">
      <h2 id="recalls-heading" className={`text-base font-semibold text-slate-800 mb-1 border-l-4 pl-3 ${recalls.length > 0 ? 'border-amber-400' : 'border-emerald-500'}`}>
        Recalls and safety alerts
      </h2>
      {recalls.length === 0 ? (
        <p className="text-sm text-slate-600">
          No FDA recalls for {name} in the last 12 months. Recalls are usually for specific lots, so check again if you hear news, or search any medicine on the{' '}
          <Link href="/recalls" className="font-medium text-emerald-700 hover:underline">FDA alerts page</Link>.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600 mb-4">
            {recalls.length === 1 ? '1 FDA recall' : `${recalls.length} FDA recalls`} for {name} in the last 12 months
            {exact > 0 ? `, ${exact} for this exact product` : ''}. Compare the lot numbers with your bottle; if they match, call your pharmacy before taking more.
          </p>
          <div className="space-y-3">
            {shown.map((r) => (
              <RecallCard key={r.id} recall={r} showMatch />
            ))}
          </div>
          {recalls.length > SHOW && (
            <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
              {all ? 'Show fewer' : `Show all ${recalls.length} recalls`}
            </button>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-slate-400">Source: FDA enforcement reports (openFDA), updated daily. Informational only; confirm with your pharmacist.</p>
    </section>
  )
}
