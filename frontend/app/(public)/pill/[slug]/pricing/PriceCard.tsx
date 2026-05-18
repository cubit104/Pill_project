'use client'

import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import AlternativesTable, { type AlternativePrice } from './AlternativesTable'
import PriceHistorySparkline, { type PriceHistoryPoint } from './PriceHistorySparkline'

interface PriceResponse {
  ndc: string
  price_per_unit: number
  unit: string
  effective_date: string
  source: string
  total_acquisition_cost: number
  fair_retail_low: number
  fair_retail_high: number
  match_type?: string
  matched_ndc?: string
  source_rxcui?: string
  resolved_ingredient?: string
  resolved_rxcui?: string
  equivalent_count?: number
  disclaimers: string[]
}

interface AlternativesResponse {
  alternatives: AlternativePrice[]
}

interface HistoryResponse {
  history: PriceHistoryPoint[]
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')

function formatNdcForDisplay(ndc?: string): string | null {
  if (!ndc) return null
  const digits = ndc.replace(/\D/g, '')
  if (digits.length !== 11) return ndc
  return `${digits.slice(0, 5)}-${digits.slice(5, 9)}-${digits.slice(9)}`
}

interface PriceCardInitialData {
  price: PriceResponse
  alternatives?: AlternativePrice[]
  history?: PriceHistoryPoint[]
}

export default function PriceCard({
  ndc,
  rxcui,
  medicineName,
  initialData,
}: {
  ndc?: string
  rxcui?: string
  medicineName?: string
  initialData?: PriceCardInitialData
}) {
  const hasIdentifier = !!(ndc || rxcui || medicineName)
  const [price, setPrice] = useState<PriceResponse | null>(initialData?.price || null)
  const [alternatives, setAlternatives] = useState<AlternativePrice[]>(initialData?.alternatives || [])
  const [history, setHistory] = useState<PriceHistoryPoint[]>(initialData?.history || [])
  const [loading, setLoading] = useState<boolean>(hasIdentifier && !initialData)
  const [fetchError, setFetchError] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)

  useEffect(() => {
    if ((!ndc && !rxcui && !medicineName) || initialData) return
    if (!API_BASE) {
      console.error('NEXT_PUBLIC_API_BASE_URL not configured')
      setLoading(false)
      setFetchError(true)
      return
    }
    let cancelled = false

    const tryFetch = async (url: string): Promise<PriceResponse | null> => {
      try {
        const res = await fetch(url)
        if (res.ok) return await res.json() as PriceResponse
        if (res.status === 404) return null
        return null
      } catch {
        return null
      }
    }

    const fetchPrice = async (): Promise<PriceResponse | null> => {
      if (ndc) {
        const result = await tryFetch(`${API_BASE}/api/prices/${encodeURIComponent(ndc)}`)
        if (result) return result
      }
      if (rxcui) {
        const result = await tryFetch(`${API_BASE}/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`)
        if (result) return result
      }
      if (medicineName) {
        const result = await tryFetch(`${API_BASE}/api/prices/by-name/${encodeURIComponent(medicineName)}`)
        if (result) return result
      }
      return null
    }

    const load = async () => {
      try {
        const priceData = await fetchPrice()

        if (cancelled) return

        setPrice(priceData)
        setLoading(false)
        if (!priceData) {
          setAlternatives([])
          setHistory([])
          return
        }

        if (!ndc) {
          setAlternatives([])
          setHistory([])
          return
        }

        const encoded = encodeURIComponent(ndc)
        const [alternativesData, historyData] = await Promise.all([
          fetch(`${API_BASE}/api/prices/${encoded}/alternatives`).then((res) => (res.ok ? res.json() : null)),
          fetch(`${API_BASE}/api/prices/${encoded}/history?weeks=52`).then((res) => (res.ok ? res.json() : null)),
        ]) as [AlternativesResponse | null, HistoryResponse | null]
        if (cancelled) return
        setAlternatives(alternativesData?.alternatives || [])
        setHistory(historyData?.history || [])
      } catch {
        if (!cancelled) {
          setPrice(null)
          setLoading(false)
          setFetchError(true)
          setAlternatives([])
          setHistory([])
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [ndc, rxcui, medicineName, initialData, retryCount])

  const ninetyDay = useMemo(() => {
    if (!price) return null
    return price.total_acquisition_cost * 3
  }, [price])

  if (!hasIdentifier) return null

  if (loading) {
    return (
      <section className="space-y-4" aria-label="Pharmacy cost benchmark" data-testid="price-card-loading">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 animate-pulse">
          <div className="h-5 w-56 bg-slate-200 rounded mb-4" />
          <div className="h-10 w-40 bg-slate-200 rounded mb-3" />
          <div className="h-4 w-64 bg-slate-200 rounded mb-2" />
          <div className="h-3 w-48 bg-slate-200 rounded" />
        </div>
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-5 animate-pulse">
          <div className="h-4 w-32 bg-slate-200 rounded mb-2" />
          <div className="h-4 w-full bg-slate-200 rounded" />
        </div>
      </section>
    )
  }

  if (fetchError) {
    return (
      <section className="space-y-4" aria-label="Pharmacy cost benchmark" data-testid="price-card-error">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-900">💰 Pharmacy Cost Benchmark</h2>
          <p className="mt-3 text-sm text-slate-700">
            ⚠️ Unable to load price details right now. Please try again later.
          </p>
          <button
            onClick={() => { setFetchError(false); setLoading(true); setRetryCount((c) => c + 1) }}
            className="mt-4 text-sm font-medium text-sky-700 hover:underline"
          >
            Retry
          </button>
        </div>
      </section>
    )
  }

  if (!price) {
    return (
      <section className="space-y-4" aria-label="Pharmacy cost benchmark" data-testid="price-card-empty">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-900">💰 Pharmacy Cost Benchmark</h2>
          <p className="mt-3 text-sm text-slate-700">
            Price data is currently unavailable for this medication.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            This may be because the NDC is not in the NADAC weekly file, or the medication is too new.
            Please check back later.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4" aria-label="Pharmacy cost benchmark">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">Pharmacy Cost Benchmark</h2>
        {price.match_type === 'equivalent' && (
          <div className="mt-2 text-xs text-slate-500 space-y-1" role="note">
            <p>
              ℹ Pricing shown is for a therapeutically equivalent product (same active ingredient, strength, and dose
              form). The exact NDC on this page is not currently in the NADAC weekly file.
            </p>
            {price.matched_ndc && <p>Equivalent NDC: {formatNdcForDisplay(price.matched_ndc)}</p>}
          </div>
        )}
        {price.match_type === 'approximate' && (
          <div className="mt-2 text-xs text-slate-500 space-y-1" role="note">
            <p>Pricing shown is an estimate based on the active ingredient. The exact strength, dose form, and packaging may differ from this pill.</p>
            {price.resolved_ingredient && <p>Estimated from: {price.resolved_ingredient}</p>}
          </div>
        )}
        <p className="text-3xl font-bold text-slate-900 mt-2">${price.price_per_unit.toFixed(2)} <span className="text-base font-medium text-slate-500">/ {price.unit}</span></p>
        <p className="text-sm text-slate-600 mt-2">
          30-day acquisition estimate: <span className="font-semibold text-slate-900">${price.total_acquisition_cost.toFixed(2)}</span>
          {ninetyDay !== null && <span> · 90-day: <span className="font-semibold text-slate-900">${ninetyDay.toFixed(2)}</span></span>}
        </p>
        <p className="text-xs text-slate-500 mt-1">Source: {price.source} · Effective: {price.effective_date}</p>
      </div>

      <div className="bg-sky-50 border border-sky-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-sky-900 mb-1">What this means</h3>
        <p className="text-sm text-sky-800">NADAC is an official benchmark for what pharmacies pay to acquire a drug, not a coupon or your final checkout price.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-slate-900 mb-2">Estimated fair retail range</h3>
        <p className="text-2xl font-semibold text-emerald-700">${price.fair_retail_low.toFixed(2)} – ${price.fair_retail_high.toFixed(2)}</p>
        <p className="text-xs text-slate-500 mt-1">For a typical 30-day supply (1 unit/day).</p>
      </div>

      <AlternativesTable alternatives={alternatives} />
      <PriceHistorySparkline history={history} />

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Important disclaimers</h3>
        <ul className="list-disc ml-5 text-xs text-slate-600 space-y-1">
          {(price.disclaimers || []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
