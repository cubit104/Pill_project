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
  disclaimers: string[]
}

interface AlternativesResponse {
  alternatives: AlternativePrice[]
}

interface HistoryResponse {
  history: PriceHistoryPoint[]
}

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

interface PriceCardInitialData {
  price: PriceResponse
  alternatives?: AlternativePrice[]
  history?: PriceHistoryPoint[]
}

export default function PriceCard({ ndc, initialData }: { ndc?: string; initialData?: PriceCardInitialData }) {
  const [price, setPrice] = useState<PriceResponse | null>(initialData?.price || null)
  const [alternatives, setAlternatives] = useState<AlternativePrice[]>(initialData?.alternatives || [])
  const [history, setHistory] = useState<PriceHistoryPoint[]>(initialData?.history || [])

  useEffect(() => {
    if (!ndc || initialData) return
    const encoded = encodeURIComponent(ndc)

    void Promise.all([
      fetch(`${API_BASE}/api/prices/${encoded}`).then((res) => (res.ok ? res.json() : null)),
      fetch(`${API_BASE}/api/prices/${encoded}/alternatives`).then((res) => (res.ok ? res.json() : null)),
      fetch(`${API_BASE}/api/prices/${encoded}/history?weeks=52`).then((res) => (res.ok ? res.json() : null)),
    ]).then(([priceData, alternativesData, historyData]: [PriceResponse | null, AlternativesResponse | null, HistoryResponse | null]) => {
      setPrice(priceData)
      setAlternatives(alternativesData?.alternatives || [])
      setHistory(historyData?.history || [])
    })
  }, [ndc, initialData])

  const ninetyDay = useMemo(() => {
    if (!price) return null
    return price.total_acquisition_cost * 3
  }, [price])

  if (!ndc || !price) return null

  return (
    <section className="space-y-4" aria-label="Pharmacy cost benchmark">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">Pharmacy Cost Benchmark</h2>
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
