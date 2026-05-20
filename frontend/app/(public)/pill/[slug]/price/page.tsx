import type { Metadata } from 'next'
import React from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import PriceCard from '../pricing/PriceCard'
import { fetchPill } from '../page'
import { formatStrength } from './formatStrength'
import { fetchInitialPriceData } from './priceData'

function resolveImageUrl(pill: {
  image_url?: string | null
  images?: Array<string | { url?: string | null } | null>
}): string {
  if (pill.image_url?.trim()) return pill.image_url.trim()
  if (!Array.isArray(pill.images) || pill.images.length === 0) return ''
  const first = pill.images[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && 'url' in first) return first.url || ''
  return ''
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

  const drugName = pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : slug
  const formattedStrength = formatStrength(pill.strength ?? null)
  const imageUrl = resolveImageUrl(pill)
  const genericFor = pill.generic_for?.trim() || ''
  const brandOrGeneric = pill.brand_or_generic
  let descriptor = ''
  if (brandOrGeneric === 'brand') descriptor = 'Brand'
  else if (brandOrGeneric === 'generic' || genericFor) descriptor = 'Generic'
  const detailsText = [
    descriptor ? (genericFor ? `${descriptor} for: ${genericFor}` : descriptor) : (genericFor ? `Generic for: ${genericFor}` : ''),
    pill.ndc ? `NDC: ${pill.ndc}` : '',
  ].filter(Boolean).join(' · ')
  const initialPriceData = await fetchInitialPriceData({
    ndc: pill.ndc,
    rxcui: pill.rxcui,
    medicineName: pill.drug_name,
  })

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
              loading="lazy"
              referrerPolicy="no-referrer"
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

      <PriceCard
        ndc={pill.ndc}
        rxcui={pill.rxcui}
        medicineName={pill.drug_name}
        initialData={initialPriceData}
      />
    </div>
  )
}
