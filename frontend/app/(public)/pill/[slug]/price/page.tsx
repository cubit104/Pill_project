import type { Metadata } from 'next'
import React from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import PriceCard from '../pricing/PriceCard'
import { fetchPill } from '../page'
import { formatStrength } from './formatStrength'

const PUBLIC_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')
const PRICE_FETCH_TIMEOUT_MS = 5000

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

interface PriceCardInitialData {
  price: PriceResponse
}

async function fetchInitialPriceData({
  ndc,
  rxcui,
  medicineName,
}: {
  ndc?: string
  rxcui?: string
  medicineName?: string
}): Promise<PriceCardInitialData | undefined> {
  if (!PUBLIC_API_BASE) return undefined

  const tryFetch = async (url: string): Promise<PriceResponse | null> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PRICE_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) return null
      return await res.json() as PriceResponse
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  if (ndc) {
    const byNdc = await tryFetch(`${PUBLIC_API_BASE}/api/prices/${encodeURIComponent(ndc)}`)
    if (byNdc) return { price: byNdc }
  }
  if (rxcui) {
    const byRxcui = await tryFetch(`${PUBLIC_API_BASE}/api/prices/by-rxcui/${encodeURIComponent(rxcui)}`)
    if (byRxcui) return { price: byRxcui }
  }
  if (medicineName) {
    const byName = await tryFetch(`${PUBLIC_API_BASE}/api/prices/by-name/${encodeURIComponent(medicineName)}`)
    if (byName) return { price: byName }
  }
  return undefined
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) {
    return {
      title: 'Price details | PillSeek',
      robots: { index: false, follow: true },
    }
  }

  const drugName = pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : slug
  const strength = pill.strength?.trim() || ''
  const titleName = [drugName, strength].filter(Boolean).join(' ').trim()
  return {
    title: `${titleName || drugName} – Price details | PillSeek`,
  }
}

export default async function PillPricePage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()
  const initialData = await fetchInitialPriceData({
    ndc: pill.ndc,
    rxcui: pill.rxcui,
    medicineName: pill.drug_name,
  })

  const drugName = pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : slug
  const formattedStrength = formatStrength(pill.strength ?? null)
  const imageUrl = pill.image_url?.trim() || ''
  const genericFor = pill.generic_for?.trim() || ''
  const brandOrGeneric = pill.brand_or_generic
  let descriptor = ''
  if (brandOrGeneric === 'brand') descriptor = 'Brand'
  else if (brandOrGeneric === 'generic' || genericFor) descriptor = 'Generic'
  const detailsText = [
    descriptor ? (genericFor ? `${descriptor} for: ${genericFor}` : descriptor) : (genericFor ? `Generic for: ${genericFor}` : ''),
    pill.ndc ? `NDC: ${pill.ndc}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" data-testid="pill-price-page">
      <Link
        href={`/pill/${encodeURIComponent(slug)}`}
        className="inline-flex items-center text-sm font-medium text-sky-700 hover:underline"
      >
        ← Back to {drugName}
      </Link>

      <header className="mb-6">
        <div className="flex items-start gap-4 mb-6">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${pill.drug_name} pill`}
              className="w-16 h-16 md:w-20 md:h-20 rounded-lg border border-slate-200 object-contain bg-white"
            />
          ) : (
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-lg border border-slate-200 bg-white flex items-center justify-center">
              <span className="text-5xl">💊</span>
            </div>
          )}
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900">
              {pill.drug_name}{formattedStrength ? ` ${formattedStrength}` : ''}
            </h1>
            {detailsText ? <p className="text-slate-600 mt-1">{detailsText}</p> : null}
          </div>
        </div>
      </header>

      <PriceCard ndc={pill.ndc} rxcui={pill.rxcui} medicineName={pill.drug_name} initialData={initialData} />
    </div>
  )
}
