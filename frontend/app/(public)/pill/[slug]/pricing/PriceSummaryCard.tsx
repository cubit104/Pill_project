'use client'

import React from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'

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

function hasCompactPriceData(price: PriceResponse | null): price is PriceResponse {
  return Boolean(
    price &&
    Number.isFinite(price.price_per_unit) &&
    Number.isFinite(price.total_acquisition_cost) &&
    typeof price.unit === 'string' &&
    price.unit.trim()
  )
}

export default function PriceSummaryCard({
  slug,
  ndc,
  rxcui,
  medicineName,
  initialData,
}: {
  slug: string
  ndc?: string
  rxcui?: string
  medicineName?: string
  initialData?: PriceResponse
}) {
  const hasIdentifier = Boolean(ndc || rxcui || medicineName)
  const [price, setPrice] = useState<PriceResponse | null>(initialData || null)
  const [loading, setLoading] = useState<boolean>(hasIdentifier && !initialData)

  useEffect(() => {
    if (!hasIdentifier || initialData) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setPrice(null)

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

    // Use relative paths so the request is proxied through the Next.js rewrite
    // (`/api/:path* → ${API_BASE_URL}/api/:path*`) — no CORS issues.
    const load = async () => {
      const byNdc = ndc ? await tryFetch(`/api/prices/${encodeURIComponent(ndc)}`) : null
      if (cancelled) return
      if (byNdc) {
        setPrice(byNdc)
        setLoading(false)
        return
      }

      const byRxcui = rxcui ? await tryFetch(`/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`) : null
      if (cancelled) return
      if (byRxcui) {
        setPrice(byRxcui)
        setLoading(false)
        return
      }

      const byName = medicineName ? await tryFetch(`/api/prices/by-name/${encodeURIComponent(medicineName)}`) : null
      if (cancelled) return
      setPrice(byName)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [hasIdentifier, ndc, rxcui, medicineName, initialData])
  const hasPriceData = hasCompactPriceData(price)

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 h-full" aria-label="Price summary">
      <h3 className="text-sm font-semibold text-slate-800">
        💰 {medicineName ? `${medicineName} Retail Price` : 'Price'}
      </h3>
      {loading ? (
        <div className="mt-3 space-y-3" aria-live="polite" aria-busy="true" data-testid="price-summary-loading">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-slate-300 border-t-emerald-600 animate-spin" aria-hidden="true" />
            <span>Checking price…</span>
          </div>
          <div className="space-y-2 animate-pulse">
            <div className="h-4 w-24 bg-slate-200 rounded" />
            <div className="h-8 w-36 bg-slate-200 rounded" />
            <div className="h-4 w-28 bg-slate-200 rounded" />
          </div>
        </div>
      ) : hasPriceData ? (
        <>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-slate-500">Per unit</span>
              <span className="text-xl font-bold text-slate-900">
                ${price.price_per_unit.toFixed(2)}
                <span className="text-sm font-medium text-slate-500"> / {price.unit}</span>
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-slate-500">30-day est.</span>
              <span className="text-base font-semibold text-slate-800">
                ${price.total_acquisition_cost.toFixed(2)}
              </span>
            </div>
          </div>
          {(price.match_type === 'equivalent' || price.match_type === 'approximate') && (
            <p className="mt-2 text-xs text-slate-500">
              ⓘ {price.match_type === 'equivalent' ? 'Equivalent product pricing shown.' : 'Ingredient-based estimate shown.'}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-700">
          Price data not available for this pill yet.
        </p>
      )}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <Link
          href={`/pill/${encodeURIComponent(slug)}/price`}
          className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
        >
          {hasPriceData ? 'See Full Price Details' : 'See Pricing Details'}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  )
}
