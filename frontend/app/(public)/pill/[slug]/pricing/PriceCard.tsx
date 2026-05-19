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
  is_stale?: boolean
  disclaimers: string[]
}

interface AlternativesResponse {
  alternatives: AlternativePrice[]
  generic_vs_brand_ratio?: number | null
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

function unitLabel(unit: string): string {
  if (unit === 'EA') return 'tablet'
  return unit
}

interface PriceCardInitialData {
  price: PriceResponse
  alternatives?: AlternativePrice[]
  history?: PriceHistoryPoint[]
  generic_vs_brand_ratio?: number | null
}

function resolveDownstreamNdc(priceData: PriceResponse | null, fallbackNdc?: string): string | null {
  if (
    priceData?.match_type === 'equivalent'
    && priceData.matched_ndc
    && priceData.matched_ndc.replace(/\D/g, '').length === 11
  ) {
    return priceData.matched_ndc.replace(/\D/g, '')
  }
  if (!fallbackNdc) return null
  const digits = fallbackNdc.replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

/**
 * Fetch only the downstream `/alternatives` and `/history` endpoints for an
 * already-resolved price.  Used when the price was seeded via SSR
 * `initialData` so we don't need to re-fetch it, but alternatives / history
 * were not included in the server-side pass.
 */
export async function fetchPriceCardDownstream({
  price,
  fallbackNdc,
  apiBase,
  fetchImpl = fetch,
}: {
  price: PriceResponse
  fallbackNdc?: string
  apiBase: string
  fetchImpl?: typeof fetch
}): Promise<{
  alternativesData: AlternativesResponse | null
  historyData: HistoryResponse | null
}> {
  const downstreamNdc = resolveDownstreamNdc(price, fallbackNdc)
  if (!downstreamNdc) {
    return { alternativesData: null, historyData: null }
  }
  const encoded = encodeURIComponent(downstreamNdc)
  const [alternativesData, historyData] = await Promise.all([
    fetchImpl(`${apiBase}/api/prices/${encoded}/alternatives`).then((r) => (r.ok ? r.json() : null)),
    fetchImpl(`${apiBase}/api/prices/${encoded}/history?weeks=52`).then((r) => (r.ok ? r.json() : null)),
  ]) as [AlternativesResponse | null, HistoryResponse | null]
  return { alternativesData, historyData }
}

export async function fetchPriceCardData({
  ndc,
  rxcui,
  medicineName,
  apiBase,
  fetchImpl = fetch,
}: {
  ndc?: string
  rxcui?: string
  medicineName?: string
  apiBase: string
  fetchImpl?: typeof fetch
}): Promise<{
  priceData: PriceResponse | null
  alternativesData: AlternativesResponse | null
  historyData: HistoryResponse | null
}> {
  const tryFetch = async (url: string): Promise<PriceResponse | null> => {
    try {
      const res = await fetchImpl(url)
      if (res.ok) return await res.json() as PriceResponse
      if (res.status === 404) return null
      return null
    } catch {
      return null
    }
  }

  let priceData: PriceResponse | null = null
  if (ndc) {
    priceData = await tryFetch(`${apiBase}/api/prices/${encodeURIComponent(ndc)}`)
  }
  if (!priceData && rxcui) {
    priceData = await tryFetch(`${apiBase}/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`)
  }
  if (!priceData && medicineName) {
    priceData = await tryFetch(`${apiBase}/api/prices/by-name/${encodeURIComponent(medicineName)}`)
  }

  const downstreamNdc = resolveDownstreamNdc(priceData, ndc)
  if (!priceData || !downstreamNdc) {
    return {
      priceData,
      alternativesData: null,
      historyData: null,
    }
  }

  const encoded = encodeURIComponent(downstreamNdc)
  const [alternativesData, historyData] = await Promise.all([
    fetchImpl(`${apiBase}/api/prices/${encoded}/alternatives`).then((res) => (res.ok ? res.json() : null)),
    fetchImpl(`${apiBase}/api/prices/${encoded}/history?weeks=52`).then((res) => (res.ok ? res.json() : null)),
  ]) as [AlternativesResponse | null, HistoryResponse | null]

  return { priceData, alternativesData, historyData }
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
  const [genericVsBrandRatio, setGenericVsBrandRatio] = useState<number | null | undefined>(initialData?.generic_vs_brand_ratio)
  const [loading, setLoading] = useState<boolean>(hasIdentifier && !initialData)
  const [fetchError, setFetchError] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)

  useEffect(() => {
    if (!ndc && !rxcui && !medicineName) return

    // If initialData supplies everything we need, skip all fetches.
    if (
      initialData?.price
      && initialData.alternatives !== undefined
      && initialData.history !== undefined
    ) return

    if (!API_BASE) {
      console.error('NEXT_PUBLIC_API_BASE_URL not configured')
      setLoading(false)
      setFetchError(true)
      return
    }

    // Case: price is already seeded from SSR but downstream data is missing.
    // Only fetch alternatives + history using the matched NDC.
    // Uses its own `cancelled` flag scoped to this branch.
    if (initialData?.price) {
      let cancelled = false
      const load = async () => {
        try {
          const { alternativesData, historyData } = await fetchPriceCardDownstream({
            price: initialData.price,
            fallbackNdc: ndc,
            apiBase: API_BASE,
          })
          if (cancelled) return
          setAlternatives(alternativesData?.alternatives || [])
          setHistory(historyData?.history || [])
          setGenericVsBrandRatio(alternativesData?.generic_vs_brand_ratio ?? null)
        } catch {
          // Non-fatal: price is already shown; just leave alternatives/history empty.
        }
      }
      load()
      return () => {
        cancelled = true
      }
    }

    // Case: no initialData — full fetch chain (price + alternatives + history).
    let cancelled = false
    const load = async () => {
      try {
        const { priceData, alternativesData, historyData } = await fetchPriceCardData({
          ndc,
          rxcui,
          medicineName,
          apiBase: API_BASE,
        })

        if (cancelled) return

        setPrice(priceData)
        setLoading(false)
        if (!priceData) {
          setAlternatives([])
          setHistory([])
          setGenericVsBrandRatio(null)
          return
        }
        if (cancelled) return
        setAlternatives(alternativesData?.alternatives || [])
        setHistory(historyData?.history || [])
        setGenericVsBrandRatio(alternativesData?.generic_vs_brand_ratio ?? null)
      } catch {
        if (!cancelled) {
          setPrice(null)
          setLoading(false)
          setFetchError(true)
          setAlternatives([])
          setHistory([])
          setGenericVsBrandRatio(null)
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

  const handleRetry = () => {
    setFetchError(false)
    setLoading(true)
    setRetryCount((c) => c + 1)
  }

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
            onClick={handleRetry}
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" aria-label="Pharmacy cost benchmark">

      {/* ── Section 1: 💰 Pharmacy Cost Benchmark ── */}
      <div className="bg-gradient-to-r from-emerald-50 to-white px-6 pt-5 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">💰&nbsp; Pharmacy Cost Benchmark</h3>
      </div>
      <div className="px-6 pb-5 pt-3">
        <p className="text-4xl font-bold text-slate-900">
          ${price.price_per_unit.toFixed(2)}{' '}
          <span className="text-base font-medium text-slate-500">/ {unitLabel(price.unit)}</span>
        </p>
        <p className="text-sm text-slate-600 mt-2">
          30-day estimate: <span className="font-semibold text-slate-900">${price.total_acquisition_cost.toFixed(2)}</span>
          {ninetyDay !== null && (
            <span> · 90-day: <span className="font-semibold text-slate-900">${ninetyDay.toFixed(2)}</span></span>
          )}
        </p>
        <p className="text-xs text-slate-500 mt-1">Source: {price.source} · Effective: {price.effective_date}</p>
        {price.is_stale === true && (
          <p
            className="mt-2 text-xs text-amber-700"
            role="note"
            aria-label={`Pricing data may be outdated. Last updated ${price.effective_date}.`}
          >
            <span aria-hidden="true">⚠ </span>
            Pricing data may be outdated (last updated {price.effective_date}).
          </p>
        )}
        {price.match_type === 'equivalent' && (
          <p className="mt-2 text-xs text-slate-500" role="note">
            ⓘ Pricing shown is for a therapeutically equivalent product (same active ingredient, strength, and dose form).
            {price.matched_ndc && <span> Equivalent NDC: {formatNdcForDisplay(price.matched_ndc)}</span>}
          </p>
        )}
        {price.match_type === 'approximate' && (
          <p className="mt-2 text-xs text-slate-500" role="note">
            ⓘ Pricing shown is an estimate based on the active ingredient. The exact strength, dose form, and packaging may differ.
            {price.resolved_ingredient && <span> Estimated from: {price.resolved_ingredient}</span>}
          </p>
        )}
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-700">Estimated fair retail range</p>
          <p className="text-xl font-semibold text-emerald-700">${price.fair_retail_low.toFixed(2)} – ${price.fair_retail_high.toFixed(2)}</p>
          <p className="text-xs text-slate-500 mt-0.5">For a typical 30-day supply (1 unit/day).</p>
        </div>
      </div>

      {/* ── Section 2: 🔄 Compare Alternatives ── */}
      <div className="border-t border-slate-100 px-6 py-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">🔄&nbsp; Compare Alternatives</h3>
        <AlternativesTable alternatives={alternatives} genericVsBrandRatio={genericVsBrandRatio} />
      </div>

      {/* ── Section 3: 📈 Price History ── */}
      <div className="border-t border-slate-100 px-6 py-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">📈&nbsp; Price History (last 12 months)</h3>
        {history.length > 0 ? (
          <PriceHistorySparkline history={history} />
        ) : (
          <p className="text-sm text-slate-500">
            Historical data starts collecting today — check back in a few weeks.
          </p>
        )}
      </div>

      {/* ── Section 4: ⚠️ Important ── */}
      <div className="border-t border-slate-100 px-6 py-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">⚠️&nbsp; Important</h3>
        <ul className="list-disc ml-5 text-xs text-slate-600 space-y-1">
          {(price.disclaimers || []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
