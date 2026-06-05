'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Severity = 'major' | 'moderate' | 'minor' | 'unknown'
type SeverityFilter = 'all' | Severity

type SeveritySummary = { major: number; moderate: number; minor: number; unknown: number }

type DrugInteractionItem = {
  drug_name: string
  rxcui: string | null
  severity: Severity | null
  description: string | null
  confidence: 'high' | 'medium' | 'low' | null
  source_kaggle: boolean
  source_openfda: boolean
}

type DrugInteractionsListResponse = {
  total: number
  severity_summary: SeveritySummary
  interactions: DrugInteractionItem[]
}

type InteractionResponse = {
  drug1: string
  drug2: string
  severity: string | null
  description: string | null
  found: boolean
}

type InteractionsClientProps = {
  drugName: string
  genericName: string | null
  rxcui: string | null
  slug: string
  initialTotal: number
  initialSeveritySummary: SeveritySummary
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

const SEVERITY_COLORS: Record<string, string> = {
  major: 'bg-red-500',
  moderate: 'bg-orange-400',
  minor: 'bg-yellow-400',
  unknown: 'bg-slate-300',
}

const SEVERITY_TEXT_COLORS: Record<string, string> = {
  major: 'text-red-700',
  moderate: 'text-orange-600',
  minor: 'text-yellow-600',
  unknown: 'text-slate-500',
}

function severityKey(value: string | null | undefined): Severity {
  return value === 'major' || value === 'moderate' || value === 'minor' ? value : 'unknown'
}

function truncate(value: string | null | undefined, maxLength: number): string {
  if (!value) return 'No description available.'
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

export default function InteractionsClient({
  drugName,
  genericName,
  rxcui,
  slug,
  initialTotal,
  initialSeveritySummary,
}: InteractionsClientProps) {
  const [filter, setFilter] = useState<SeverityFilter>('all')
  const [items, setItems] = useState<DrugInteractionItem[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(initialTotal)
  const [severitySummary, setSeveritySummary] = useState<SeveritySummary>(initialSeveritySummary)
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [drug2Input, setDrug2Input] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<InteractionResponse | null>(null)

  const showingCount = items.length
  const hasMore = showingCount < total
  const allCount = severitySummary.major + severitySummary.moderate + severitySummary.minor + severitySummary.unknown
  const genericSuffix = genericName?.trim() ? ` (${genericName.trim()})` : ''
  const backHref = `/pill/${encodeURIComponent(slug)}`

  const filterOptions: Array<{ id: SeverityFilter; label: string; count?: number; dotClass?: string }> = useMemo(
    () => [
      { id: 'all', label: 'All', count: allCount },
      { id: 'major', label: 'Major', count: severitySummary.major, dotClass: 'bg-red-500' },
      { id: 'moderate', label: 'Moderate', count: severitySummary.moderate, dotClass: 'bg-orange-400' },
      { id: 'minor', label: 'Minor', count: severitySummary.minor, dotClass: 'bg-yellow-400' },
      { id: 'unknown', label: 'Unknown', count: severitySummary.unknown, dotClass: 'bg-slate-300' },
    ],
    [allCount, severitySummary]
  )

  const loadInteractions = useCallback(async (nextPage: number, append: boolean) => {
    setLoadingList(true)
    setListError(null)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        per_page: '20',
      })
      if (filter !== 'all') params.set('severity', filter)

      const res = await fetch(
        buildApiUrl(`/api/interactions/${encodeURIComponent(drugName)}?${params.toString()}`)
      )
      if (!res.ok) throw new Error('Failed to load interactions')

      const payload = (await res.json()) as DrugInteractionsListResponse
      if (filter === 'all') {
        setSeveritySummary({
          major: payload.severity_summary?.major ?? 0,
          moderate: payload.severity_summary?.moderate ?? 0,
          minor: payload.severity_summary?.minor ?? 0,
          unknown: payload.severity_summary?.unknown ?? 0,
        })
      }
      setTotal(typeof payload.total === 'number' ? payload.total : 0)
      setPage(nextPage)
      setItems((prev) => (append ? [...prev, ...(payload.interactions || [])] : (payload.interactions || [])))
    } catch {
      setListError('Unable to load interactions right now.')
      if (!append) setItems([])
    } finally {
      setLoadingList(false)
    }
  }, [drugName, filter])

  useEffect(() => {
    setItems([])
    setPage(0)
    setTotal(0)
    void loadInteractions(1, false)
  }, [filter, loadInteractions])

  const handleCheck = async () => {
    const drug2 = drug2Input.trim()
    if (!drug2 || checking) return
    setChecking(true)
    setCheckError(null)
    setCheckResult(null)
    try {
      const params = new URLSearchParams({
        drug1: drugName,
        drug2,
      })
      const res = await fetch(buildApiUrl(`/api/interactions?${params.toString()}`))
      if (!res.ok) throw new Error('Failed to check interaction')
      const payload = (await res.json()) as InteractionResponse
      setCheckResult(payload)
    } catch {
      setCheckError('Could not check interactions right now. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-6" data-rxcui={rxcui || undefined}>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-slate-700 text-sm leading-7">
          There are <strong>{initialTotal.toLocaleString()}</strong> drugs known to interact with{' '}
          <strong>{drugName}</strong>
          {genericSuffix}.
        </p>
        <p className="text-slate-700 text-sm leading-7 mt-2">
          Of the total drug interactions, <strong>{initialSeveritySummary.major.toLocaleString()}</strong> are major,{' '}
          <strong>{initialSeveritySummary.moderate.toLocaleString()}</strong> are moderate, and{' '}
          <strong>{initialSeveritySummary.minor.toLocaleString()}</strong> are minor.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-800 mb-3">Does {drugName} interact with my other drugs?</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={drugName}
            disabled
            className="w-full sm:w-1/3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
            aria-label="Current drug"
          />
          <span className="hidden sm:flex items-center text-slate-500 px-1">+</span>
          <input
            value={drug2Input}
            onChange={(event) => setDrug2Input(event.target.value)}
            placeholder="Enter a drug name..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
            aria-label="Second drug name"
          />
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking || !drug2Input.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            Check
          </button>
        </div>

        {checking && <p className="text-sm text-slate-500 mt-3" aria-live="polite">Loading…</p>}
        {checkError && <p className="text-sm text-red-600 mt-3">{checkError}</p>}
        {checkResult && !checking && !checkError && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {checkResult.found ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                      SEVERITY_TEXT_COLORS[severityKey(checkResult.severity)] || 'text-slate-600'
                    } bg-white border border-slate-200`}
                  >
                    {severityKey(checkResult.severity)}
                  </span>
                </div>
                <p>{checkResult.description || 'Interaction found in our database.'}</p>
              </div>
            ) : (
              <p>
                No interaction found between {checkResult.drug1} and {checkResult.drug2} in our database.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 pb-3">
          {filterOptions.map((option) => {
            const active = filter === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`inline-flex items-center gap-2 text-sm ${
                  active ? 'font-semibold text-slate-900 underline underline-offset-4' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    option.dotClass || 'border border-slate-300 bg-white'
                  }`}
                  aria-hidden="true"
                />
                {option.label} ({option.count ?? 0})
              </button>
            )
          })}
        </div>

        <div className="mt-4 space-y-3">
          {items.map((item, index) => {
            const itemSeverity = severityKey(item.severity)
            return (
              <article key={`${item.drug_name}-${item.rxcui || 'na'}-${index}`} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${SEVERITY_COLORS[itemSeverity]}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        {item.drug_name}
                      </span>
                      <span className={`text-xs font-semibold uppercase ${SEVERITY_TEXT_COLORS[itemSeverity]}`}>
                        {itemSeverity}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{truncate(item.description, 120)}</p>
                  </div>
                </div>
              </article>
            )
          })}

          {listError && <p className="text-sm text-red-600">{listError}</p>}

          {!loadingList && !listError && items.length === 0 && (
            <p className="text-sm text-slate-500">
              {filter === 'all'
                ? `No interactions found for ${drugName}.`
                : `No ${filter} interactions found for ${drugName}.`}
            </p>
          )}
        </div>

        {loadingList && <p className="mt-4 text-sm text-slate-500" aria-live="polite">Loading…</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Showing {showingCount.toLocaleString()} of {total.toLocaleString()}
          </p>
          {hasMore && !loadingList && (
            <button
              type="button"
              onClick={() => void loadInteractions(page + 1, true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
            >
              Load more
            </button>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <Link href={backHref} className="text-sm text-slate-600 hover:text-slate-900 hover:underline">
            ← Back to {drugName}
          </Link>
        </div>
      </section>
    </div>
  )
}
