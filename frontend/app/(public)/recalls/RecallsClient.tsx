'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import RecallCard from '../../components/RecallCard'
import { latestRecalls, recallsForDrug, type Recall } from '../../lib/recalls'
import DrugAutocompleteInput from '../interactions/DrugAutocompleteInput'

/**
 * FDA alerts: type a medicine (live suggestions, same as the interactions
 * checker), see its recalls in the last 12 months; below, the newest recalls
 * nationwide. Same layout as Find a doctor.
 */
export default function RecallsClient({ initialDrug }: { initialDrug?: string }) {
  const [q, setQ] = useState(initialDrug ?? '')
  const [picked, setPicked] = useState<string | null>(null)
  const [results, setResults] = useState<Recall[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<Recall[] | null>(null)
  const [latestError, setLatestError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (name: string, push = true) => {
    const term = name.trim()
    if (!term) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPicked(term)
    setQ(term)
    setLoading(true)
    setError(null)
    if (push && typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}?drug=${encodeURIComponent(term)}`)
    try {
      const rows = await recallsForDrug(term, null, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResults(rows)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (err) {
      if (ctrl.signal.aborted) return
      setResults(null)
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    latestRecalls(20, ctrl.signal)
      .then((rows) => !ctrl.signal.aborted && setLatest(rows))
      .catch(() => !ctrl.signal.aborted && setLatestError(true))
    return () => ctrl.abort()
  }, [])

  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current) return
    ranInitial.current = true
    if (initialDrug) void search(initialDrug, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    abortRef.current?.abort()
    setQ('')
    setPicked(null)
    setResults(null)
    setError(null)
    setLoading(false)
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname)
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(q)
        }}
        className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/5 sm:p-5"
      >
        <label htmlFor="recall-drug" className="block px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Medicine
        </label>
        <div className="mt-1 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <DrugAutocompleteInput
            id="recall-drug"
            value={q}
            onChange={(v) => {
              setQ(v)
              if (picked && v !== picked) setPicked(null)
            }}
            onSelect={(v) => void search(v)}
            placeholder="Type a medicine, e.g. Metformin"
            ariaLabel="Medicine"
            className="h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={loading || !q.trim()} className="inline-flex h-14 items-center justify-center rounded-xl bg-emerald-600 px-8 text-base font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60">
              {loading ? 'Checking…' : 'Check'}
            </button>
            {(results || q) && (
              <button type="button" onClick={clear} className="inline-flex h-14 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Clear
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            {error}
          </p>
        )}
      </form>

      {(results !== null || loading) && (
        <section ref={resultsRef} className="mx-auto mt-8 max-w-4xl scroll-mt-20">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {loading && !results
              ? 'Checking the FDA…'
              : results && results.length === 0
                ? `No recalls for ${picked ?? q}`
                : `${results?.length} ${results?.length === 1 ? 'recall' : 'recalls'} for ${picked ?? q}`}
          </h2>
          <div className="mt-4 space-y-3">
            {loading && !results && Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
            {results && results.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <p className="text-lg font-semibold text-slate-900">No recalls in the last 12 months</p>
                <p className="mt-1 text-sm text-slate-600">Nothing from the FDA for this medicine. Recalls are often for specific lots, so check again if you hear news.</p>
              </div>
            )}
            {results?.map((r) => <RecallCard key={r.id} recall={r} />)}
          </div>
        </section>
      )}

      <section className="mx-auto mt-10 max-w-4xl">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Latest recalls nationwide</h2>
        <div className="mt-4 space-y-3">
          {latest === null && !latestError && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
          {latestError && <p className="text-sm text-slate-600">Could not load the latest recalls right now.</p>}
          {latest?.map((r) => <RecallCard key={r.id} recall={r} />)}
        </div>
      </section>
    </div>
  )
}
