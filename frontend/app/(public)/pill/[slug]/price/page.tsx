import type { Metadata } from 'next'
import React from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { safeJsonLd } from '../../../../lib/structured-data'
import { resolveImageUrl } from '../../../../lib/image-url'
import PriceCard from '../pricing/PriceCard'
import type { PriceCardInitialData, PriceSnapshot } from '../pricing/priceCardData'
import { fetchPill } from '../page'
import { formatStrength } from './formatStrength'
import { fetchInitialPriceData, fetchPriceSnapshot } from './priceData'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) {
    return {
      title: 'Price details',
      robots: { index: false, follow: true },
    }
  }

  const drugName = pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : slug
  const strength = pill.strength?.trim() || ''
  const titleName = [drugName, strength].filter(Boolean).join(' ').trim()
  const title = `${titleName || drugName} – Price details`
  const canonicalUrl = `${SITE_URL}/pill/${encodeURIComponent(slug)}/price`

  return {
    title,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/price` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      url: canonicalUrl,
    },
  }
}

function buildSchemaData({
  slug,
  name,
  imageUrl,
  snapshot,
  fallbackData,
}: {
  slug: string
  name: string
  imageUrl: string
  snapshot: PriceSnapshot | null
  fallbackData?: PriceCardInitialData
}) {
  const pageUrl = `${SITE_URL}/pill/${encodeURIComponent(slug)}/price`
  const base = {
    '@context': 'https://schema.org',
    name,
    description: `Retail price and cost comparison for ${name}.`,
    url: pageUrl,
    ...(imageUrl ? { image: imageUrl } : {}),
  }

  if (snapshot) {
    if (!snapshot.schema_offers_valid) {
      return {
        ...base,
        '@type': 'WebPage',
      }
    }
    return {
      ...base,
      '@type': 'Product',
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'USD',
        lowPrice: snapshot.fair_retail_low,
        highPrice: snapshot.fair_retail_high,
        offerCount: 1,
      },
    }
  }

  const price = fallbackData?.price
  const hasValidOffers =
    price?.fair_retail_low != null &&
    price?.fair_retail_high != null

  if (!hasValidOffers) {
    return {
      ...base,
      '@type': 'WebPage',
    }
  }

  return {
    ...base,
    '@type': 'Product',
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: price.fair_retail_low,
      highPrice: price.fair_retail_high,
      offerCount: 1,
    },
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
  const priceSnapshot = await fetchPriceSnapshot(slug)
  const fallbackPriceData = priceSnapshot ? undefined : await fetchInitialPriceData({
    ndc: pill.ndc,
    rxcui: pill.rxcui,
    medicineName: pill.drug_name,
    historyNdc: pill.history_ndc,
    historySource: pill.history_source,
  })
  const initialPriceData = priceSnapshot ?? fallbackPriceData
  const schemaDisplayName = `${pill.drug_name}${formattedStrength ? ` ${formattedStrength}` : ''}`.trim()
  const schemaData = buildSchemaData({
    slug,
    name: schemaDisplayName,
    imageUrl,
    snapshot: priceSnapshot,
    fallbackData: fallbackPriceData,
  })

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(schemaData) }}
      />
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
          historyNdc={pill.history_ndc}
          initialData={initialPriceData}
        />
      </div>
    </>
  )
}
