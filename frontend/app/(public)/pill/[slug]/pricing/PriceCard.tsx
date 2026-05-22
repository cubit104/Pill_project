'use client'

import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import AlternativesTable, { type AlternativePrice } from './AlternativesTable'
import PriceHistorySparkline, { type PriceHistoryPoint } from './PriceHistorySparkline'
import StrengthSelector, { type StrengthOption } from './StrengthSelector'
import {
  fetchPriceCardDownstream,
  resolveDownstreamNdc,
  type PriceCardInitialData,
  type PriceResponse,
} from './priceCardData'

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

function preferServerData<T>(serverValue: T | undefined, clientValue: T): T {
  return serverValue ?? clientValue
}

export { fetchPriceCardDownstream, resolveDownstreamNdc, type PriceCardInitialData }

export default function PriceCard({
  ndc,
  rxcui,
  medicineName,
  historyNdc,
  initialData,
}: {
  ndc?: string
  rxcui?: string
  medicineName?: string
  historyNdc?: string | null
  initialData?: PriceCardInitialData
}) {
  // Use relative paths so requests go through the Next.js rewrite proxy
  // (`/api/:path* → ${API_BASE_URL}/api/:path*`) — no CORS issues from the browser.
  const apiBase = ''
  const hasIdentifier = !!(ndc || rxcui || medicineName)
  const [priceState, setPriceState] = useState<PriceResponse | null>(initialData?.price || null)
  const [alternativesState, setAlternativesState] = useState<AlternativePrice[]>(initialData?.alternatives || [])
  const [historyState, setHistoryState] = useState<PriceHistoryPoint[]>(initialData?.history || [])
  const [genericVsBrandRatioState, setGenericVsBrandRatioState] = useState<number | null | undefined>(initialData?.generic_vs_brand_ratio)
  const [strengthsState, setStrengthsState] = useState<StrengthOption[]>(initialData?.strengths || [])
  const [ingredientState, setIngredientState] = useState<string | null>(initialData?.ingredient ?? null)
  const [loading, setLoading] = useState<boolean>(hasIdentifier && !initialData?.price)
  const [fetchError, setFetchError] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)
  // Server-provided data must win on every render so SSR payloads remain authoritative
  // during client transitions, while local state only fills gaps after client fetches.
  const price = preferServerData(initialData?.price, priceState)
  const alternatives = preferServerData(initialData?.alternatives, alternativesState)
  const history = preferServerData(initialData?.history, historyState)
  const genericVsBrandRatio = preferServerData(initialData?.generic_vs_brand_ratio, genericVsBrandRatioState)
  const strengths = preferServerData(initialData?.strengths, strengthsState)
  const ingredient = preferServerData(initialData?.ingredient, ingredientState)
  const hasCompleteInitialData = !!(
    initialData?.price &&
    Array.isArray(initialData.alternatives) &&
    Array.isArray(initialData.history)
  )

  useEffect(() => {
    if ((!ndc && !rxcui && !medicineName) || initialData?.price) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFetchError(false)
    setPriceState(null)
    setAlternativesState([])
    setHistoryState([])
    setGenericVsBrandRatioState(null)
    setStrengthsState([])
    setIngredientState(null)

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
        const result = await tryFetch(`${apiBase}/api/prices/${encodeURIComponent(ndc)}`)
        if (result) return result
      }
      if (rxcui) {
        const result = await tryFetch(`${apiBase}/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`)
        if (result) return result
      }
      if (medicineName) {
        const result = await tryFetch(`${apiBase}/api/prices/by-name/${encodeURIComponent(medicineName)}`)
        if (result) return result
      }
      return null
    }

    const load = async () => {
      try {
        const priceData = await fetchPrice()

        if (cancelled) return

        setPriceState(priceData)
        setLoading(false)
        if (!priceData) {
          setAlternativesState([])
          setHistoryState([])
          setGenericVsBrandRatioState(null)
          setStrengthsState([])
          setIngredientState(null)
          return
        }
      } catch {
        if (!cancelled) {
          setPriceState(null)
          setLoading(false)
          setFetchError(true)
          setAlternativesState([])
          setHistoryState([])
          setGenericVsBrandRatioState(null)
          setStrengthsState([])
          setIngredientState(null)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [ndc, rxcui, medicineName, initialData?.price, retryCount])

  useEffect(() => {
    const priceData = initialData?.price ?? priceState
    if (!priceData) {
      setAlternativesState([])
      setHistoryState([])
      setGenericVsBrandRatioState(null)
      setStrengthsState([])
      setIngredientState(null)
      return
    }
    if (hasCompleteInitialData) return

    const downstreamNdc = resolveDownstreamNdc(priceData, ndc)
    setAlternativesState([])
    setHistoryState([])
    setGenericVsBrandRatioState(null)
    setStrengthsState([])
    setIngredientState(null)
    if (!downstreamNdc) return

    let cancelled = false
    const loadDownstream = async () => {
      const downstream = await fetchPriceCardDownstream({
        apiBase,
        downstreamNdc,
        historyNdc: historyNdc === null ? null : historyNdc,
        priceResponse: priceData,
      })
      if (cancelled) return
      if (downstream.alternativesFailed || downstream.historyFailed) {
        console.warn('PriceCard downstream fetch failed', { downstreamNdc })
      }
      setAlternativesState(downstream.alternatives)
      setHistoryState(downstream.history)
      setGenericVsBrandRatioState(downstream.genericVsBrandRatio)
      setStrengthsState(downstream.strengths)
      setIngredientState(downstream.ingredient)
    }

    loadDownstream().catch(() => {
      if (cancelled) return
      console.warn('PriceCard downstream fetch failed', { downstreamNdc })
      setAlternativesState([])
      setHistoryState([])
      setGenericVsBrandRatioState(null)
      setStrengthsState([])
      setIngredientState(null)
    })

    return () => {
      cancelled = true
    }
  }, [
    hasCompleteInitialData,
    initialData?.price,
    initialData?.alternatives,
    initialData?.history,
    ndc,
    historyNdc,
    priceState,
  ])

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

      {/* ── Section 1.5: 💊 Other Strengths ── */}
      {strengths && strengths.some((s) => !s.is_current) && (
        <div className="border-t border-slate-100 px-6 py-5">
          <StrengthSelector strengths={strengths} ingredient={ingredient ?? null} />
        </div>
      )}

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
