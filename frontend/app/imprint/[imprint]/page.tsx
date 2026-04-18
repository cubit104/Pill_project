import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PillCard from '../../components/PillCard'
import type { PillResult, SearchResponse } from '../../types'
import { breadcrumbSchema, hubPageSchema, safeJsonLd } from '../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

async function fetchPillsByImprint(imprint: string): Promise<PillResult[]> {
  try {
    const params = new URLSearchParams({
      q: imprint,
      type: 'imprint',
      per_page: '48',
    })
    const res = await fetch(`${API_BASE}/api/search?${params}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const data: SearchResponse = await res.json()
    return data.results
  } catch {
    return []
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ imprint: string }> }
): Promise<Metadata> {
  const { imprint } = await params
  const displayImprint = decodeURIComponent(imprint).toUpperCase()
  const title = `Imprint ${displayImprint} Pill — Identify Pill With Imprint ${displayImprint}`
  const description = `Identify the pill with imprint ${displayImprint}. View drug name, color, shape, strength, and full medication details. FDA-powered pill identifier.`.slice(0, 155)

  return {
    title,
    description,
    alternates: { canonical: `/imprint/${encodeURIComponent(imprint)}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/imprint/${encodeURIComponent(imprint)}`,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ImprintHubPage(
  { params }: { params: Promise<{ imprint: string }> }
) {
  const { imprint } = await params
  const displayImprint = decodeURIComponent(imprint).toUpperCase()
  const pills = await fetchPillsByImprint(decodeURIComponent(imprint))

  if (!displayImprint) notFound()

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: `Imprint ${displayImprint}`, url: `/imprint/${encodeURIComponent(imprint)}` },
  ])

  const hubJson = hubPageSchema({
    name: `Pill With Imprint ${displayImprint}`,
    description: `Identify the pill with imprint code ${displayImprint}. View drug name, color, shape, and strength from the FDA database.`,
    url: `/imprint/${encodeURIComponent(imprint)}`,
  })

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(hubJson) }}
      />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Imprint {displayImprint}</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          Pill With Imprint {displayImprint}
        </h1>

        <p className="text-slate-600 leading-relaxed mb-8 max-w-2xl">
          This page shows all pills in our database with the imprint code{' '}
          <strong className="font-mono">{displayImprint}</strong>. Imprint codes are stamped
          or printed on pill tablets and capsules and are used to uniquely identify medications.
          Data is sourced from the FDA NDC Directory and DailyMed.
        </p>

        {/* Results */}
        {pills.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="text-4xl mb-4" role="img" aria-label="No results">🔍</div>
            <h2 className="text-xl font-semibold text-slate-700 mb-2">
              No pills found with imprint &ldquo;{displayImprint}&rdquo;
            </h2>
            <p className="text-slate-600 text-sm mb-4">
              The imprint may have a different format in our database. Try searching manually.
            </p>
            <Link
              href={`/search?q=${encodeURIComponent(imprint)}&type=imprint`}
              className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
            >
              Search for {displayImprint} →
            </Link>
          </div>
        ) : (
          <>
            <p className="text-slate-500 text-sm mb-4">
              Found {pills.length} pill{pills.length !== 1 ? 's' : ''} with imprint{' '}
              <strong className="font-mono">{displayImprint}</strong>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pills.map((pill, idx) => (
                <PillCard key={pill.ndc || pill.slug || idx} pill={pill} />
              ))}
            </div>
          </>
        )}

        {/* Informational section */}
        <div className="mt-10 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-3">
            What is an imprint code?
          </h2>
          <p className="text-slate-700 text-sm leading-relaxed">
            An imprint code is a combination of letters, numbers, or symbols that appears on
            a pill, tablet, or capsule. The FDA requires all approved drug products to have a
            unique imprint so that they can be identified in case of accidental ingestion or
            medication confusion. The imprint{' '}
            <strong className="font-mono">{displayImprint}</strong> is the code found on the
            pill you are looking up.
          </p>
        </div>

        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-amber-800 text-sm leading-relaxed">
            <strong>⚠️ Disclaimer:</strong> Pill identification is for educational purposes
            only. Always confirm identification with a licensed pharmacist.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
              Read full disclaimer
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  )
}
