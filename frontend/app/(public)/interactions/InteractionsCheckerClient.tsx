'use client'

import { useMemo, useRef, useState } from 'react'

type InteractionResponse = {
  drug1: string
  drug2: string
  drug1_rxcui: string | null
  drug2_rxcui: string | null
  severity: string | null
  description: string | null
  confidence: string | null
  source_kaggle: boolean
  source_openfda: boolean
  found: boolean
  message: string | null
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
const MAX_DRUGS = 10
const DESCRIPTION_TRUNCATE_LENGTH = 200
const MAX_DRUGS_ERROR = 'Maximum 10 drugs allowed. Remove one to add another.'
const MIN_DRUGS_ERROR = 'Add at least 2 medications to check interactions'

const SEVERITY_RANK: Record<'major' | 'moderate' | 'minor' | 'unknown', number> = {
  major: 0,
  moderate: 1,
  minor: 2,
  unknown: 3,
}

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

function severityKey(value: string | null | undefined): 'major' | 'moderate' | 'minor' | 'unknown' {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'major') return 'major'
  if (normalized === 'moderate') return 'moderate'
  if (normalized === 'minor') return 'minor'
  return 'unknown'
}

function confidenceBadgeText(value: string | null | undefined): 'High' | 'Medium' | 'Low' | null {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'high') return 'High'
  if (normalized === 'medium') return 'Medium'
  if (normalized === 'low') return 'Low'
  return null
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

function truncateText(text: string, maxLength = DESCRIPTION_TRUNCATE_LENGTH): { shortText: string; needsToggle: boolean } {
  if (text.length <= maxLength) {
    return { shortText: text, needsToggle: false }
  }
  return { shortText: `${text.slice(0, maxLength)}...`, needsToggle: true }
}

export default function InteractionsCheckerClient() {
  const [drugInput, setDrugInput] = useState('')
  const [drugList, setDrugList] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<PairResult[] | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [expandedPairs, setExpandedPairs] = useState<Record<string, boolean>>({})

  const inputRef = useRef<HTMLInputElement>(null)

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
      inputRef.current?.focus()
      return
    }

    setDrugList((prev) => [...prev, trimmed])
    setDrugInput('')
    setResults(null)
    setCheckError(null)
    setExpandedPairs({})
    inputRef.current?.focus()
  }

  const removeDrug = (drugToRemove: string): void => {
    setDrugList((prev) => prev.filter((drug) => drug !== drugToRemove))
    setResults(null)
    setCheckError(null)
    setExpandedPairs({})
  }

  const startOver = (): void => {
    setDrugInput('')
    setDrugList([])
    setResults(null)
    setCheckError(null)
    setExpandedPairs({})
    inputRef.current?.focus()
  }

  const handleCheck = async (): Promise<void> => {
    if (checking) return

    if (drugList.length < 2) {
      setCheckError(MIN_DRUGS_ERROR)
      return
    }

    setChecking(true)
    setCheckError(null)
    setExpandedPairs({})

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

        if (a.error !== b.error) return a.error ? 1 : -1
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

  const totalPairs = useMemo(() => (drugList.length * (drugList.length - 1)) / 2, [drugList])
  const foundCount = useMemo(
    () => (results || []).filter((item) => item.result?.found === true).length,
    [results]
  )

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            type="text"
            value={drugInput}
            onChange={(event) => {
              setDrugInput(event.target.value)
              if (checkError === MAX_DRUGS_ERROR || checkError === MIN_DRUGS_ERROR) {
                setCheckError(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addDrug()
              }
            }}
            placeholder="Enter a drug name..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800"
            aria-label="Drug name"
          />
          <button
            type="button"
            onClick={addDrug}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Add
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-800">Drug list</h2>
            <button
              type="button"
              onClick={startOver}
              disabled={drugList.length === 0 && !drugInput && !results}
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
            Check Interactions
          </button>
        </div>

        {checking && (
          <p className="mt-3 text-center text-sm text-slate-500" aria-live="polite">
            Checking {totalPairs} pairs...
          </p>
        )}

        {checkError && <p className="mt-3 text-sm text-red-600">{checkError}</p>}
      </section>

      {results && (
        <section className="space-y-3" aria-live="polite">
          <h2 className="text-sm font-semibold text-slate-800">
            Found {foundCount} interaction(s) across {results.length} drug pair(s) checked
          </h2>

          {results.map((item) => {
            if (item.error) {
              return (
                <article key={pairKey(item.drug1, item.drug2)} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span aria-hidden="true">⚠ </span>
                  Could not check {item.drug1} + {item.drug2} due to a temporary network or server issue.
                  Please try again.
                </article>
              )
            }

            if (!item.result || item.result.found !== true) {
              return (
                <article key={pairKey(item.drug1, item.drug2)} role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-medium"><span aria-hidden="true">✓ </span>No interaction found between {item.drug1} + {item.drug2}</p>
                  <p className="mt-1 text-slate-600">No known interaction found in our database.</p>
                </article>
              )
            }

            const severity = severityKey(item.result.severity)
            const style = SEVERITY_STYLES[severity]
            const description = item.result.description || 'Interaction found in our database.'
            const { shortText, needsToggle } = truncateText(description)
            const key = pairKey(item.drug1, item.drug2)
            const expanded = expandedPairs[key] === true
            const confidence = confidenceBadgeText(item.result.confidence)

            return (
              <article key={key} className={`rounded-lg border p-4 ${style.bg} ${style.border}`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>
                    {severity}
                  </span>
                  <h3 className={`text-sm font-semibold ${style.text}`}>
                    {item.drug1} + {item.drug2}
                  </h3>
                </div>

                <p className={`mt-2 text-sm ${style.text}`}>
                  {expanded ? description : shortText}
                </p>

                {needsToggle && (
                  <button
                    type="button"
                    onClick={() => setExpandedPairs((prev) => ({ ...prev, [key]: !expanded }))}
                    className="mt-1 text-xs font-medium text-slate-700 hover:underline"
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {item.result.source_kaggle && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">📊 Kaggle</span>
                  )}
                  {item.result.source_openfda && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">🧪 OpenFDA</span>
                  )}
                  {confidence && (
                    <span aria-label={`Confidence level: ${confidence}`} className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                      {confidence}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      )}

      <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p>
          <span aria-hidden="true">⚠️ </span>
          This tool checks drug-drug interactions only and is for informational purposes only.
          It does not cover food, alcohol, or disease interactions. Always consult your pharmacist
          or doctor before taking multiple medications.
        </p>
      </section>
    </div>
  )
}
