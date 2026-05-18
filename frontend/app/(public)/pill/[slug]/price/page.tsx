import type { Metadata } from 'next'
import React from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import PriceCard from '../pricing/PriceCard'
import { fetchPill } from '../page'

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
  return {
    title: `${drugName} – Price details | PillSeek`,
  }
}

export default async function PillPricePage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const drugName = pill.drug_name && pill.drug_name !== 'Unknown' ? pill.drug_name : slug

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" data-testid="pill-price-page">
      <Link
        href={`/pill/${encodeURIComponent(slug)}`}
        className="inline-flex items-center text-sm font-medium text-sky-700 hover:underline"
      >
        ← Back to {drugName}
      </Link>

      <PriceCard ndc={pill.ndc} rxcui={pill.rxcui} medicineName={pill.drug_name} />
    </div>
  )
}
