import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import type { PillResult } from '../../../../types'
import { breadcrumbSchema, safeJsonLd } from '../../../../lib/structured-data'
import { slugifyDrugName } from '../../../../lib/slug'
import { fetchPillsByDrug, toTitleCase } from '../page'
import PriceCard from '../../../pill/[slug]/pricing/PriceCard'
import type { PriceCardInitialData } from '../../../pill/[slug]/pricing/priceCardData'
import { fetchInitialPriceData } from '../../../pill/[slug]/price/priceData'

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

const MAX_PRICE_CANDIDATES = 6

function hasResolvedPrice(initialData?: PriceCardInitialData): boolean {
  return Boolean(
    initialData?.price &&
    Number.isFinite(initialData.price.price_per_unit) &&
    Number.isFinite(initialData.price.total_acquisition_cost)
  )
}

async function resolveRepresentativePriceData(
  pills: PillResult[]
): Promise<{ pill: PillResult; initialData: PriceCardInitialData } | null> {
  const candidates = await Promise.all(
    pills
      .filter((pill) => pill.slug && (pill.ndc || pill.rxcui || pill.drug_name))
      .slice(0, MAX_PRICE_CANDIDATES)
      .map(async (pill) => ({
        pill,
        initialData: await fetchInitialPriceData({
          ndc: pill.ndc,
          rxcui: pill.rxcui,
          medicineName: pill.drug_name,
        }).catch(() => undefined),
      }))
  )

  const match = candidates.find((candidate) => hasResolvedPrice(candidate.initialData))
  return match?.initialData ? { pill: match.pill, initialData: match.initialData } : null
}

// Shared per-request resolution — React cache() deduplicates the fetches so
// both generateMetadata() and the page component consume a single result.
const getRepresentativePriceData = cache(async (decoded: string) => {
  const searchResult = await fetchPillsByDrug(decoded)
  const representative = await resolveRepresentativePriceData(searchResult.results)
  return { searchResult, representative }
})

export async function generateMetadata(
  { params }: { params: Promise<{ name: string }> }
): Promise<Metadata> {
  const { name } = await params
  const decoded = decodeURIComponent(name)
  const canonicalSlug = slugifyDrugName(decoded) || decoded
  const displayName = toTitleCase(canonicalSlug.replace(/-/g, ' '))
  const { representative } = await getRepresentativePriceData(decoded)
  const robots = representative
    ? { index: true, follow: true }
    : { index: false, follow: true }
  const title = `${displayName} Price — NADAC Benchmark & 12-Month History`
  const description = `Compare ${displayName} NADAC benchmark pricing, 30-day and 90-day estimates, 12-month price history, and brand-vs-generic alternatives where available.`.slice(0, 155)

  return {
    title,
    description,
    robots,
    alternates: { canonical: `/drug/${canonicalSlug}/price` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/drug/${canonicalSlug}/price`,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function DrugPricePage(
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const decoded = decodeURIComponent(name)
  const canonicalSlug = slugifyDrugName(decoded) || decoded
  if (name !== canonicalSlug) {
    redirect(`/drug/${canonicalSlug}/price`)
  }

  const displayName = toTitleCase(canonicalSlug.replace(/-/g, ' '))
  if (!displayName) notFound()

  const { searchResult, representative } = await getRepresentativePriceData(decoded)
  const pills = searchResult.results
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: displayName, url: `/drug/${canonicalSlug}` },
    { name: 'Price', url: `/drug/${canonicalSlug}/price` },
  ])
  const visiblePills = pills.slice(0, 12)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li><Link href={`/drug/${canonicalSlug}`} className="hover:text-sky-700">{displayName}</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="font-medium text-slate-700">Price</li>
          </ol>
        </nav>

        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                {displayName} Price
              </h1>
              <p className="mt-2 max-w-3xl text-slate-600">
                Review NADAC benchmark pricing, 30-day and 90-day estimates, 12-month
                price history, and lower-cost alternatives for {displayName} when available.
              </p>
            </div>
            <Link
              href={`/drug/${canonicalSlug}`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-sky-300 hover:text-sky-700"
            >
              Browse all {displayName} pills
            </Link>
          </div>
          {searchResult.fallbackUsed && searchResult.fallbackTerm && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              ℹ️ No direct results were found for &ldquo;{decoded}&rdquo;. Showing pricing for {searchResult.fallbackTerm}.
            </div>
          )}
        </header>

        {representative ? (
          <>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Showing benchmark pricing for a representative {displayName} variant
              {representative.pill.strength ? ` (${representative.pill.strength})` : ''}.
              Explore the pills below to compare imprints, strengths, and images.
            </div>
            <PriceCard
              ndc={representative.pill.ndc}
              rxcui={representative.pill.rxcui}
              medicineName={representative.pill.drug_name}
              initialData={representative.initialData}
            />
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
            NADAC pricing is not available for {displayName} right now. You can still browse
            the available pill variants below, and this page is kept out of search until real
            pricing data resolves.
          </div>
        )}

        {visiblePills.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {displayName} variants
              </h2>
              <span className="text-sm text-slate-500">
                {pills.length} total pill{pills.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePills.map((pill, index) => (
                <Link
                  key={pill.slug || pill.ndc || `${pill.drug_name}-${index}`}
                  href={pill.slug ? `/pill/${encodeURIComponent(pill.slug)}` : `/drug/${canonicalSlug}`}
                  className="rounded-lg border border-slate-200 p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                >
                  <div className="font-semibold text-slate-900">{pill.drug_name}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {[pill.strength, pill.imprint].filter(Boolean).join(' · ') || 'View details'}
                  </div>
                  {(pill.color || pill.shape) && (
                    <div className="mt-1 text-xs text-slate-500">
                      {[pill.color, pill.shape].filter(Boolean).join(' • ')}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
