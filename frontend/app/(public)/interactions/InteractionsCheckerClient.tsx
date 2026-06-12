'use client'

import { useMemo, useState } from 'react'
import DrugAutocompleteInput from './DrugAutocompleteInput'

type Severity = 'major' | 'moderate' | 'minor' | 'unknown'
type SeverityFilter = 'all' | Severity
type TabId = 'drug-drug' | 'drug-food' | 'drug-disease'

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
  reference_text: string | null
  management: string | null
  confidence: string | null
  source_kaggle: boolean
  source_openfda: boolean
  source_ddinter: boolean
  found: boolean
}

type DrugFoodInteractionItem = {
  selected_drug: string
  matched_drug_name: string
  food_name: string
  level: string
  interaction: string | null
  management: string | null
  ref_text: string | null
  source_ddinter: boolean
}

type DrugDiseaseInteractionItem = {
  selected_drug: string
  matched_drug_name: string
  disease_name: string
  level: string
  text: string | null
  ref_text: string | null
  source_ddinter: boolean
}

type InteractionCheckResponse = {
  drugs: string[]
  pairs: InteractionResponse[]
  food_interactions: DrugFoodInteractionItem[]
  disease_interactions: DrugDiseaseInteractionItem[]
  summary: {
    severity: Record<Severity, number>
    sections: {
      drug_drug: number
      drug_food: number
      drug_disease: number
    }
  }
}

const SEVERITY_STYLES = {
  major: { dot: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', text: 'text-red-800' },
  moderate: { dot: 'bg-orange-400', bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', text: 'text-orange-800' },
  minor: { dot: 'bg-yellow-400', bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', text: 'text-yellow-800' },
  unknown: { dot: 'bg-slate-300', bg: 'bg-slate-50', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-600', text: 'text-slate-700' },
} as const

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''
const MAX_DRUGS = 10
const MIN_DRUGS_ERROR = 'Add at least 2 medications to check interactions.'
const MAX_DRUGS_ERROR = 'Maximum 10 drugs allowed. Remove one to add another.'
const INPUT_ID = 'interactions-drug-input'
const FALLBACK_DESCRIPTION = 'Interaction identified in clinical drug databases. Consult your pharmacist or prescriber before use.'

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

function sourceBadges(result: InteractionResponse): string[] {
  const badges: string[] = []
  if (result.source_ddinter) badges.push('DDInter')
  if (result.source_kaggle) badges.push('Kaggle')
  if (result.source_openfda) badges.push('OpenFDA/FDA')
  return badges
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
  const [results, setResults] = useState<InteractionCheckResponse | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [activeTab, setActiveTab] = useState<TabId>('drug-drug')

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
    setActiveTab('drug-drug')
    focusDrugInput()
  }

  const removeDrug = (drugToRemove: string): void => {
    setDrugList((prev) => prev.filter((drug) => drug !== drugToRemove))
    setResults(null)
    setCheckError(null)
    setSeverityFilter('all')
    setActiveTab('drug-drug')
  }

  const startOver = (): void => {
    setDrugInput('')
    setDrugList([])
    setResults(null)
    setCheckError(null)
    setSeverityFilter('all')
    setActiveTab('drug-drug')
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
    setActiveTab('drug-drug')

    try {
      const res = await fetch(buildApiUrl('/api/interactions/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drugs: drugList }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const payload = (await res.json()) as InteractionCheckResponse

      const sortedPairs = [...(payload.pairs || [])].sort((a, b) => {
        const aFound = a.found === true
        const bFound = b.found === true
        if (aFound !== bFound) return aFound ? -1 : 1
        if (aFound && bFound) {
          return SEVERITY_RANK[severityKey(a.severity)] - SEVERITY_RANK[severityKey(b.severity)]
        }
        return pairKey(a.drug1, a.drug2).localeCompare(pairKey(b.drug1, b.drug2))
      })

      const sortedFood = [...(payload.food_interactions || [])].sort(
        (a, b) =>
          SEVERITY_RANK[severityKey(a.level)] - SEVERITY_RANK[severityKey(b.level)] ||
          `${a.selected_drug}${a.food_name}`.localeCompare(`${b.selected_drug}${b.food_name}`)
      )
      const sortedDisease = [...(payload.disease_interactions || [])].sort(
        (a, b) =>
          SEVERITY_RANK[severityKey(a.level)] - SEVERITY_RANK[severityKey(b.level)] ||
          `${a.selected_drug}${a.disease_name}`.localeCompare(`${b.selected_drug}${b.disease_name}`)
      )

      setResults({
        ...payload,
        pairs: sortedPairs,
        food_interactions: sortedFood,
        disease_interactions: sortedDisease,
      })
    } catch {
      setCheckError('Could not check interactions right now. Please try again.')
      setResults(null)
    } finally {
      setChecking(false)
    }
  }

  const filterOptions: Array<{ id: SeverityFilter; label: string; count: number; dotClass?: string }> = useMemo(
    () => {
      const base = results?.summary?.severity || { major: 0, moderate: 0, minor: 0, unknown: 0 }
      return [
        { id: 'all', label: 'All', count: results?.summary?.sections?.drug_drug ?? 0 },
        { id: 'major', label: 'Major', count: base.major ?? 0, dotClass: 'bg-red-500' },
        { id: 'moderate', label: 'Moderate', count: base.moderate ?? 0, dotClass: 'bg-orange-400' },
        { id: 'minor', label: 'Minor', count: base.minor ?? 0, dotClass: 'bg-yellow-400' },
        { id: 'unknown', label: 'Unknown', count: base.unknown ?? 0, dotClass: 'bg-slate-300' },
      ]
    },
    [results]
  )

  const visiblePairs = useMemo(() => {
    const pairs = (results?.pairs || []).filter((item) => item.found === true)
    if (severityFilter === 'all') return pairs
    return pairs.filter((item) => severityKey(item.severity) === severityFilter)
  }, [results, severityFilter])

  const tabCounts = useMemo(
    () => ({
      'drug-drug': results?.summary?.sections?.drug_drug ?? 0,
      'drug-food': results?.summary?.sections?.drug_food ?? 0,
      'drug-disease': results?.summary?.sections?.drug_disease ?? 0,
    }),
    [results]
  )

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
        <section className="space-y-4" aria-live="polite">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Summary</p>
            <p className="mt-1">
              {results.summary.severity.major} major · {results.summary.severity.moderate} moderate · {results.summary.severity.minor} minor · {results.summary.sections.drug_food} food interaction(s) · {results.summary.sections.drug_disease} condition warning(s)
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="Interaction sections">
            {([
              { id: 'drug-drug', label: 'Drug-Drug' },
              { id: 'drug-food', label: 'Drug-Food' },
              { id: 'drug-disease', label: 'Drug-Disease' },
            ] as Array<{ id: TabId; label: string }>).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  activeTab === tab.id ? 'bg-emerald-100 text-emerald-800 font-semibold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label} ({tabCounts[tab.id]})
              </button>
            ))}
          </div>

          {activeTab === 'drug-drug' && (
            <>
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

              {visiblePairs.length === 0 ? (
                <p className="text-sm text-slate-500">No interactions found for the current severity filter.</p>
              ) : (
                visiblePairs.map((item) => {
                  const key = pairKey(item.drug1, item.drug2)
                  const severity = severityKey(item.severity)
                  const style = SEVERITY_STYLES[severity]
                  const displayTitle = `${drugLabel(item.drug1, item.drug1_generic)} ⇌ ${drugLabel(item.drug2, item.drug2_generic)}`
                  const applies = `${appliesLabel(item.drug1_brands, item.drug1_generic, item.drug1)}, ${appliesLabel(item.drug2_brands, item.drug2_generic, item.drug2)}`
                  const badges = sourceBadges(item)

                  return (
                    <article key={key} className={`rounded-lg border p-4 ${style.bg} ${style.border}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>
                          {severity}
                        </span>
                        {badges.map((badge) => (
                          <span key={badge} className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 border border-slate-200">
                            {badge}
                          </span>
                        ))}
                        <h3 className={`text-sm font-semibold ${style.text}`}>{displayTitle}</h3>
                      </div>
                      <p className={`mt-2 text-sm ${style.text}`}>
                        <span className="font-medium">Applies to:</span> {applies}
                      </p>
                      <p className={`mt-3 whitespace-pre-line text-sm ${style.text}`}>{item.description || FALLBACK_DESCRIPTION}</p>
                      {item.management ? (
                        <div className="mt-3 rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                          <p className="font-semibold">Management</p>
                          <p className="mt-1 whitespace-pre-line">{item.management}</p>
                        </div>
                      ) : null}
                      {item.reference_text ? (
                        <details className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          <summary className="cursor-pointer font-semibold text-slate-700">Reference text</summary>
                          <p className="mt-2 whitespace-pre-line">{item.reference_text}</p>
                        </details>
                      ) : null}
                    </article>
                  )
                })
              )}
            </>
          )}

          {activeTab === 'drug-food' && (
            <div className="space-y-3">
              {results.food_interactions.length === 0 ? (
                <p className="text-sm text-slate-500">No drug-food interactions found for these medications.</p>
              ) : (
                results.food_interactions.map((item, idx) => {
                  const severity = severityKey(item.level)
                  const style = SEVERITY_STYLES[severity]
                  return (
                    <article key={`${item.selected_drug}-${item.food_name}-${idx}`} className={`rounded-lg border p-4 ${style.bg} ${style.border}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>{severity}</span>
                        {item.source_ddinter ? (
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 border border-slate-200">DDInter</span>
                        ) : null}
                        <h3 className={`text-sm font-semibold ${style.text}`}>{item.selected_drug} ⇌ {item.food_name}</h3>
                      </div>
                      <p className={`mt-3 text-sm ${style.text}`}>{item.interaction || FALLBACK_DESCRIPTION}</p>
                      {item.management ? (
                        <div className="mt-3 rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                          <p className="font-semibold">Management</p>
                          <p className="mt-1 whitespace-pre-line">{item.management}</p>
                        </div>
                      ) : null}
                      {item.ref_text ? (
                        <details className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          <summary className="cursor-pointer font-semibold text-slate-700">Reference text</summary>
                          <p className="mt-2 whitespace-pre-line">{item.ref_text}</p>
                        </details>
                      ) : null}
                    </article>
                  )
                })
              )}
            </div>
          )}

          {activeTab === 'drug-disease' && (
            <div className="space-y-3">
              {results.disease_interactions.length === 0 ? (
                <p className="text-sm text-slate-500">No drug-disease interactions found for these medications.</p>
              ) : (
                results.disease_interactions.map((item, idx) => {
                  const severity = severityKey(item.level)
                  const style = SEVERITY_STYLES[severity]
                  return (
                    <article key={`${item.selected_drug}-${item.disease_name}-${idx}`} className={`rounded-lg border p-4 ${style.bg} ${style.border}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>{severity}</span>
                        {item.source_ddinter ? (
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 border border-slate-200">DDInter</span>
                        ) : null}
                        <h3 className={`text-sm font-semibold ${style.text}`}>{item.selected_drug} ⇌ {item.disease_name}</h3>
                      </div>
                      <p className={`mt-3 text-sm ${style.text}`}>{item.text || FALLBACK_DESCRIPTION}</p>
                      {item.ref_text ? (
                        <details className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          <summary className="cursor-pointer font-semibold text-slate-700">Reference text</summary>
                          <p className="mt-2 whitespace-pre-line">{item.ref_text}</p>
                        </details>
                      ) : null}
                    </article>
                  )
                })
              )}
            </div>
          )}
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
