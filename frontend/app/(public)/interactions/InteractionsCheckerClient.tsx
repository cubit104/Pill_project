'use client'

import { useState } from 'react'
import Link from 'next/link'

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

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  major: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    badge: 'bg-red-100 text-red-700 border-red-200',
  },
  moderate: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-800',
    badge: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  minor: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
    badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  unknown: {
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-700',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
  },
}

function severityKey(value: string | null | undefined): string {
  const v = (value || '').toLowerCase()
  if (v === 'major' || v === 'moderate' || v === 'minor') return v
  return 'unknown'
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

function confidenceLabel(value: string | null | undefined): string | null {
  const v = (value || '').toLowerCase()
  if (v === 'high') return 'High confidence'
  if (v === 'medium') return 'Medium confidence'
  if (v === 'low') return 'Low confidence'
  return null
}

export default function InteractionsCheckerClient() {
  const [drug1Input, setDrug1Input] = useState('')
  const [drug2Input, setDrug2Input] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<InteractionResponse | null>(null)

  const handleCheck = async (): Promise<void> => {
    const drug1 = drug1Input.trim()
    const drug2 = drug2Input.trim()
    if (!drug1 || !drug2 || checking) return

    setChecking(true)
    setCheckError(null)
    setCheckResult(null)

    try {
      const params = new URLSearchParams({ drug1, drug2 })
      const res = await fetch(buildApiUrl(`/api/interactions?${params.toString()}`))
      if (!res.ok) throw new Error(`Failed to check interactions (status ${res.status})`)
      const payload = (await res.json()) as InteractionResponse
      setCheckResult(payload)
    } catch (error) {
      console.error('Interaction check failed', error)
      setCheckError('Could not check interactions right now. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  const triggerCheck = (): void => {
    void handleCheck()
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="drug1-input">Drug 1</label>
            <input
              id="drug1-input"
              type="text"
              value={drug1Input}
              onChange={(event) => setDrug1Input(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  triggerCheck()
                }
              }}
              placeholder="Enter first drug name..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="drug2-input">Drug 2</label>
            <input
              id="drug2-input"
              type="text"
              value={drug2Input}
              onChange={(event) => setDrug2Input(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  triggerCheck()
                }
              }}
              placeholder="Enter second drug name..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={triggerCheck}
            disabled={checking || !drug1Input.trim() || !drug2Input.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 rounded-lg disabled:opacity-60"
          >
            {checking ? 'Checking...' : 'Check Interaction'}
          </button>
        </div>
      </section>

      <div aria-live="polite">
        {checkError && (
          <p className="text-sm text-red-600">{checkError}</p>
        )}

        {checkResult && !checkError && (
          checkResult.found ? (
            <section
              className={`rounded-xl border p-5 ${SEVERITY_STYLES[severityKey(checkResult.severity)].bg} ${SEVERITY_STYLES[severityKey(checkResult.severity)].border}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLES[severityKey(checkResult.severity)].badge}`}>
                  {severityKey(checkResult.severity)}
                </span>
                <h2 className={`text-base font-semibold ${SEVERITY_STYLES[severityKey(checkResult.severity)].text}`}>
                  {checkResult.drug1} + {checkResult.drug2}
                </h2>
              </div>

              <p className={`mt-3 text-sm leading-relaxed ${SEVERITY_STYLES[severityKey(checkResult.severity)].text}`}>
                {checkResult.description || 'Interaction found in our database.'}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {checkResult.source_kaggle && (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-slate-700">📊 Kaggle DDI</span>
                )}
                {checkResult.source_openfda && (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-slate-700">🧪 OpenFDA</span>
                )}
                {confidenceLabel(checkResult.confidence) && (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">
                    {confidenceLabel(checkResult.confidence)}
                  </span>
                )}
              </div>

              <div className="mt-4">
<Link
  href={`/search?q=${encodeURIComponent(checkResult.drug1)}&type=drug`}
  className="text-sm font-medium text-sky-700 hover:text-sky-800 hover:underline"
>
              </div>

              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span aria-hidden="true">⚠️ </span>
                Disclaimer: This result is for informational purposes only. Always consult your pharmacist or doctor.
              </p>
            </section>
          ) : (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <h2 className="text-base font-semibold text-emerald-800">
                <span aria-hidden="true">✓ </span>
                No known interaction found
              </h2>
              <p className="mt-2 text-sm text-emerald-800">
                No interaction between {checkResult.drug1} and {checkResult.drug2} in our database.
              </p>
              <p className="mt-1 text-sm text-emerald-800">
                This does not mean it is safe to take together — always consult your pharmacist or doctor.
              </p>
            </section>
          )
        )}
      </div>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-base font-semibold text-slate-900">
          <span aria-hidden="true">ℹ️ </span>
          About this checker
        </h2>
        <p className="mt-2 text-sm text-slate-700">Data sourced from 178,000+ drug-drug interaction pairs.</p>
        <p className="mt-1 text-sm text-slate-700">Severity is classified as major, moderate, or minor.</p>
        <p className="mt-1 text-sm text-slate-700">This tool is for informational purposes only.</p>
        <p className="mt-1 text-sm text-slate-700">Always consult your pharmacist or doctor.</p>
      </section>
    </div>
  )
}
