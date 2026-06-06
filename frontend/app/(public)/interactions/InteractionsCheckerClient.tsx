'use client'

import { useMemo, useState } from 'react'
import DrugAutocompleteInput from './DrugAutocompleteInput'

type Severity = 'major' | 'moderate' | 'minor' | 'unknown'
type SeverityFilter = 'all' | Severity

type InteractionResponse = {
  drug1: string
  drug2: string
  drug1_generic: string | null
  drug2_generic: string | null
  drug1_brands: string[] | undefined
  drug2_brands: string[] | undefined
  severity: string | null
  description: string | null
  spl_text: string | null
  found: boolean
}

type PairResult = {
  drug1: string
  drug2: string
  result: InteractionResponse | null
  error: boolean
}

const SEVERITY_STYLES = {
  major: { dot: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', text: 'text-red-800' },
  moderate: { dot: 'bg-orange-400', bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', text: 'text-orange-800' },
  minor: { dot: 'bg-yellow-400', bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', text: 'text-yellow-800' },
  unknown: { dot: 'bg-slate-300', bg: 'bg-slate-50', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-600', text: 'text-slate-700' },
} as const

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || ''
const MAX_DRUGS = 10
const MIN_DRUGS_ERROR = 'Add at least 2 medications to check interactions.'
const MAX_DRUGS_ERROR = 'Maximum 10 drugs allowed. Remove one to add another.'
const INPUT_ID = 'interactions-drug-input'
const FALLBACK_DESCRIPTION = 'Interaction identified in clinical drug databases.\nConsult your pharmacist or prescriber before use.'

const SEVERITY_RANK: Record<Severity, number> = {
  major: 0,
  moderate: 1,
  minor: 2,
  unknown: 3,
}

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

function severityKey(value: string | null | undefined): Severity {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'major') return 'major'
  if (normalized === 'moderate') return 'moderate'
  if (normalized === 'minor') return 'minor'
  return 'unknown'
}

function drugLabel(typed: string, generic: string | null | undefined): string {
  const g = (generic || '').toLowerCase()
  const t = typed.toLowerCase()
  if (g && g !== t) return `${typed} (${generic})`
  return typed
}

function appliesLabel(brands: string[] | undefined, generic: string | null | undefined, fallback: string): string {
  const brand = ((brands ?? [])[0] || '').trim()
  const gen = (generic || '').trim()
  if (brand && gen && brand.toLowerCase() !== gen.toLowerCase()) return `${brand} (${gen})`
  if (brand) return brand
  if (gen) return gen
  return fallback
}

function pairKey(drug1: string, drug2: string): string {
  return `${drug1}__${drug2}`
}

function generatePairs(drugs: string[]): Array<{ drug1: string; drug2: string }> {
  const pairs: Array<{ drug1: string; drug2: string }> = []
  for (let i = 0; i < drugs.length; i += 1) {
    for (let j = i + 1; j < drugs.length; j += 1) {
      pairs.push({ drug1: drugs[i], drug2: drugs[j] })
    }
  }
  return pairs
}

function focusDrugInput() {
  const input = document.getElementById(INPUT_ID)
  if (input instanceof HTMLInputElement) {
    input.focus()
  }
}

export default function InteractionsCheckerClient() {
  const [drugInput, setDrugInput] = useState('')
  const [drugList, setDrugList] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<PairResult[] | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')

  const addDrug = (): void => {
    const trimmed = drugInput.trim()
    if (!trimmed) return

    if (drugList.length >= MAX_DRUGS) {
      setCheckError(MAX_DRUGS_ERROR)
      return
    }

    const exists = drugList.some((drug) => drug.toLowerCase() === trimmed.toLowerCase())
    if (exists) {
      setDrugInput('')
      focusDrugInput()
      return
    }

    setDrugList((prev) => [...prev, trimmed])
    setDrugInput('')
    setResults(null)
    setCheckError(null)
    setSeverityFilter('all')
    focusDrugInput()
  }

  const removeDrug = (drugToRemove: string): void => {
    setDrugList((prev) => prev.filter((drug) => drug !== drugToRemove))
    setResults(null)
    setCheckError(null)
    setSeverityFilter('all')
  }

  const startOver = (): void => {
    setDrugInput('')
    setDrugList([])
    setResults(null)
    setCheckError(null)
    setSeverityFilter('all')
    focusDrugInput()
  }

  const handleCheck = async (): Promise<void> => {
    if (checking) return

    if (drugList.length < 2) {
      setCheckError(MIN_DRUGS_ERROR)
      return
    }

    setChecking(true)
    setResults(null)
    setCheckError(null)
    setSeverityFilter('all')

    const pairs = generatePairs(drugList)

    try {
      const fetchedPairs = await Promise.all(
        pairs.map(async ({ drug1, drug2 }): Promise<PairResult> => {
          try {
            const res = await fetch(
              buildApiUrl(`/api/interactions?drug1=${encodeURIComponent(drug1)}&drug2=${encodeURIComponent(drug2)}`)
            )
            if (!res.ok) throw new Error(`status ${res.status}`)
            const payload = (await res.json()) as InteractionResponse
            return { drug1, drug2, result: payload, error: false }
          } catch {
            return { drug1, drug2, result: null, error: true }
          }
        })
      )

      const sorted = [...fetchedPairs].sort((a, b) => {
        const aFound = a.result?.found === true
        const bFound = b.result?.found === true
        if (aFound !== bFound) return aFound ? -1 : 1

        if (aFound && bFound) {
          const aSeverity = severityKey(a.result?.severity)
          const bSeverity = severityKey(b.result?.severity)
          return SEVERITY_RANK[aSeverity] - SEVERITY_RANK[bSeverity]
        }

        const aNoInteraction = a.result?.found === false
        const bNoInteraction = b.result?.found === false
        if (aNoInteraction !== bNoInteraction) return aNoInteraction ? -1 : 1

        return pairKey(a.drug1, a.drug2).localeCompare(pairKey(b.drug1, b.drug2))
      })

      setResults(sorted)
    } catch {
      setCheckError('Could not check interactions right now. Please try again.')
      setResults(null)
    } finally {
      setChecking(false)
    }
  }

  const foundCount = useMemo(
    () => (results || []).filter((item) => item.result?.found === true).length,
    [results]
  )

  const severitySummary = useMemo(() => {
    const summary: Record<Severity, number> = { major: 0, moderate: 0, minor: 0, unknown: 0 }
    for (const item of results || []) {
      if (item.result?.found === true) {
        summary[severityKey(item.result.severity)] += 1
      }
    }
    return summary
  }, [results])

  const filterOptions: Array<{ id: SeverityFilter; label: string; count: number; dotClass?: string }> = useMemo(
    () => [
      { id: 'all', label: 'All', count: (results || []).filter((item) => item.error || item.result?.found === true).length },
      { id: 'major', label: 'Major', count: severitySummary.major, dotClass: 'bg-red-500' },
      { id: 'moderate', label: 'Moderate', count: severitySummary.moderate, dotClass: 'bg-orange-400' },
      { id: 'minor', label: 'Minor', count: severitySummary.minor, dotClass: 'bg-yellow-400' },
      { id: 'unknown', label: 'Unknown', count: severitySummary.unknown, dotClass: 'bg-slate-300' },
    ],
    [results, severitySummary]
  )

  const visibleResults = useMemo(() => {
    if (!results) return []
    if (severityFilter === 'all') {
      return results.filter((item) => item.error || item.result?.found === true)
    }
    return results.filter(
      (item) => item.result?.found === true && severityKey(item.result?.severity) === severityFilter
    )
  }, [results, severityFilter])

  const totalPairs = useMemo(() => (drugList.length * (drugList.length - 1)) / 2, [drugList])

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            addDrug()
          }}
        >
          <DrugAutocompleteInput
            id={INPUT_ID}
            value={drugInput}
            onChange={(value) => {
              setDrugInput(value)
              if (checkError === MAX_DRUGS_ERROR || checkError === MIN_DRUGS_ERROR) {
                setCheckError(null)
              }
            }}
            onSelect={(value) => setDrugInput(value)}
            placeholder="Enter a drug name..."
            ariaLabel="Drug name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800"
            disabled={checking}
          />
          <button
            type="submit"
            disabled={checking}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            Add
          </button>
        </form>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-800">Drug list</h2>
            <button
              type="button"
              onClick={startOver}
              disabled={checking || (drugList.length === 0 && !drugInput && !results)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              Start over
            </button>
          </div>

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {drugList.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No medications added yet.</p>
            ) : (
              drugList.map((drug) => (
                <div key={drug} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-slate-800">{drug}</span>
                  <button
                    type="button"
                    onClick={() => removeDrug(drug)}
                    disabled={checking}
                    className="text-lg leading-none text-slate-500 hover:text-slate-800"
                    aria-label={`Remove ${drug}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={checking}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {checking ? `Checking ${totalPairs} pairs...` : 'Check Interactions'}
          </button>
        </div>

        {checkError && <p className="mt-3 text-sm text-red-600">{checkError}</p>}
      </section>

      {results && (
        <section className="space-y-3" aria-live="polite">
          <h2 className="text-sm font-semibold text-slate-800">
            Found {foundCount} interaction(s) across {results.length} pairs checked
          </h2>

          <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 pb-3" role="group" aria-label="Filter interactions by severity">
            {filterOptions.map((option) => {
              const active = severityFilter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSeverityFilter(option.id)}
                  aria-pressed={active}
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
                  {option.label} ({option.count})
                </button>
              )
            })}
          </div>

          {visibleResults.map((item) => {
            const key = pairKey(item.drug1, item.drug2)

            if (item.error) {
              return (
                <article key={key} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  ⚠ Could not check {item.drug1} + {item.drug2} due to a temporary issue. Please try again.
                </article>
              )
            }

            if (!item.result || item.result.found !== true) {
              return (
                <article key={key} role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <span aria-hidden="true">✓ </span>
                  No known interaction — {item.drug1} + {item.drug2}
                </article>
              )
            }

            const severity = severityKey(item.result.severity)
            const style = SEVERITY_STYLES[severity]
            const displayTitle = `${drugLabel(item.drug1, item.result.drug1_generic)} ⇌ ${drugLabel(item.drug2, item.result.drug2_generic)}`
            const applies = `${appliesLabel(item.result.drug1_brands, item.result.drug1_generic, item.drug1)}, ${appliesLabel(item.result.drug2_brands, item.result.drug2_generic, item.drug2)}`
            const description = item.result.description
            const splText = item.result.spl_text

            return (
              <article key={key} className={`rounded-lg border p-4 ${style.bg} ${style.border}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>
                    {severity}
                  </span>
                  <h3 className={`text-sm font-semibold ${style.text}`}>
                    {displayTitle}
                  </h3>
                </div>
                <p className={`mt-1.5 text-xs ${style.text} opacity-70`}>
                  <span className="font-semibold">Applies to:</span> {applies}
                </p>
                {description ? (
                  <p className={`mt-3 text-sm leading-relaxed font-medium ${style.text}`}>
                    {description}
                  </p>
                ) : null}
                {splText ? (
                  <div className="mt-3 rounded-md border-l-4 border-current/20 bg-white/40 px-3 py-2">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Clinical Detail
                    </p>
                    <p className={`text-sm leading-relaxed ${style.text} opacity-90`}>
                      {splText}
                    </p>
                  </div>
                ) : null}
                {!description && !splText ? (
                  <p className={`mt-3 whitespace-pre-line text-sm ${style.text}`}>{FALLBACK_DESCRIPTION}</p>
                ) : null}
              </article>
            )
          })}
        </section>
      )}

      <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p>
          <span aria-hidden="true">⚠️ </span>
          For informational purposes only. Always consult your pharmacist or doctor before taking multiple medications together.
        </p>
      </section>
    </div>
  )
}
