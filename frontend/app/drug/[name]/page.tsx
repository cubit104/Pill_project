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

function toTitleCase(str: string): string {
  return str
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

async function fetchPillsByDrug(name: string): Promise<PillResult[]> {
  try {
    const params = new URLSearchParams({ q: name, type: 'drug', per_page: '48' })
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
  { params }: { params: Promise<{ name: string }> }
): Promise<Metadata> {
  const { name } = await params
  const displayName = toTitleCase(decodeURIComponent(name))
  const title = `${displayName} Pills — Identify ${displayName} by Imprint, Color & Shape`
  const description = `Look up ${displayName} pills by imprint code, color, and shape. Find all ${displayName} medications in our FDA-powered pill identifier.`.slice(0, 155)

  return {
    title,
    description,
    alternates: { canonical: `/drug/${encodeURIComponent(name)}` },
    openGraph: { title, description, url: `${SITE_URL}/drug/${encodeURIComponent(name)}` },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function DrugHubPage(
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const displayName = toTitleCase(decodeURIComponent(name))
  const pills = await fetchPillsByDrug(displayName)

  if (!displayName) notFound()

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: displayName, url: `/drug/${encodeURIComponent(name)}` },
  ])

  const hubJson = hubPageSchema({
    name: `${displayName} Pill Identification`,
    description: `Browse all ${displayName} pills and identify them by imprint, color, and shape using FDA NDC data.`,
    url: `/drug/${encodeURIComponent(name)}`,
    dateModified: new Date().toISOString(),
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
            <li className="text-slate-700 font-medium">{displayName}</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          Identify {displayName} Pills
        </h1>

        <p className="text-slate-600 leading-relaxed mb-6 max-w-2xl">
          This page lists all {displayName} pills in our database to help you identify the
          correct medication. Each entry shows the imprint code, color, shape, and strength.
          Click any pill for full details including ingredients and manufacturer information.
          All data is sourced directly from the FDA NDC Directory and DailyMed.
        </p>

        {/* Results */}
        {pills.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="text-4xl mb-4" role="img" aria-label="No results">🔍</div>
            <h2 className="text-xl font-semibold text-slate-700 mb-2">
              No results for &ldquo;{displayName}&rdquo;
            </h2>
            <p className="text-slate-600 text-sm mb-4">
              This drug may not be in our database yet, or the name may be spelled differently.
            </p>
            <Link
              href="/search"
              className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
            >
              Search All Pills
            </Link>
          </div>
        ) : (
          <>
            <p className="text-slate-500 text-sm mb-4">
              Found {pills.length} {displayName} pill{pills.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pills.map((pill, idx) => (
                <PillCard key={pill.ndc || pill.slug || idx} pill={pill} />
              ))}
            </div>
          </>
        )}

        {/* FAQ section */}
        <div className="mt-10 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            Frequently Asked Questions about {displayName}
          </h2>
          <div className="space-y-5">
            <div>
              <h3 className="font-medium text-slate-800 mb-1">
                How do I identify a {displayName} pill?
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Look for the imprint code stamped on the pill, then note the color and shape.
                Use PillSeek to search by imprint code, or filter by color and shape, to find
                the exact {displayName} match.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-slate-800 mb-1">
                What do different {displayName} imprints mean?
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Imprint codes on {displayName} pills typically indicate the manufacturer,
                dosage strength, and formulation. Different manufacturers may produce {displayName}
                with different imprints. Always confirm identification with a licensed pharmacist.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-amber-800 text-sm leading-relaxed">
            <strong>⚠️ Disclaimer:</strong> This information is for identification purposes only.
            Always consult a licensed pharmacist or physician before taking any medication.{' '}
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
