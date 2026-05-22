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
  const [price, setPrice] = useState<PriceResponse | null>(initialData || null)

  useEffect(() => {
    if ((!ndc && !rxcui && !medicineName) || initialData) return
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

    // Use relative paths so the request is proxied through the Next.js rewrite
    // (`/api/:path* → ${API_BASE_URL}/api/:path*`) — no CORS issues.
    const load = async () => {
      const byNdc = ndc ? await tryFetch(`/api/prices/${encodeURIComponent(ndc)}`) : null
      if (cancelled) return
      if (byNdc) {
        setPrice(byNdc)
        return
      }

      const byRxcui = rxcui ? await tryFetch(`/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`) : null
      if (cancelled) return
      if (byRxcui) {
        setPrice(byRxcui)
        return
      }

      const byName = medicineName ? await tryFetch(`/api/prices/by-name/${encodeURIComponent(medicineName)}`) : null
      if (cancelled) return
      setPrice(byName)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [ndc, rxcui, medicineName, initialData])
  const hasPriceData = hasCompactPriceData(price)

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 h-full" aria-label="Price summary">
      <h2 className="text-sm font-semibold text-slate-800">💰 Price</h2>
      {hasPriceData ? (
        <>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            ${price.price_per_unit.toFixed(2)}
            <span className="text-sm font-medium text-slate-500"> / {price.unit}</span>
          </p>
          <p className="mt-1 text-sm text-slate-700">
            30-day est: <span className="font-semibold text-slate-900">${price.total_acquisition_cost.toFixed(2)}</span>
          </p>
          {(price.match_type === 'equivalent' || price.match_type === 'approximate') && (
            <p className="mt-2 text-xs text-slate-500">
              ⓘ {price.match_type === 'equivalent' ? 'Equivalent product pricing shown.' : 'Ingredient-based estimate shown.'}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-700">
          Price data unavailable for this NDC.
        </p>
      )}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <Link href={`/pill/${encodeURIComponent(slug)}/price`} className="text-sm font-semibold text-emerald-700 hover:underline">
          {hasPriceData ? 'See full price details →' : 'See pricing details →'}
        </Link>
      </div>
    </section>
  )
}
