import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import PillCard from '../../components/PillCard'
import type { PillResult, SearchResponse } from '../../types'
import { breadcrumbSchema, hubPageSchema, safeJsonLd } from '../../lib/structured-data'
import { slugifyUrl } from '../../lib/url-utils'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

// Normalize color param for display
function toTitleCase(str: string): string {
  return str
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

async function fetchPillsByColor(color: string): Promise<PillResult[]> {
  try {
    const params = new URLSearchParams({ color, per_page: '48' })
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
  { params }: { params: Promise<{ color: string }> }
): Promise<Metadata> {
  const { color } = await params
  const slugged = slugifyUrl(decodeURIComponent(color))
  const displayColor = toTitleCase(slugged.replace(/-/g, ' '))
  const title = `${displayColor} Pills — Identify ${displayColor} Medications`
  const description = `Browse and identify ${displayColor.toLowerCase()} pills by imprint, shape, and drug name. Free pill identifier powered by FDA data.`.slice(0, 155)

  return {
    title,
    description,
    alternates: { canonical: `/color/${slugged}` },
    openGraph: { title, description, url: `${SITE_URL}/color/${slugged}` },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ColorHubPage(
  { params }: { params: Promise<{ color: string }> }
) {
  const { color } = await params
  const slugged = slugifyUrl(decodeURIComponent(color))
  if (color !== slugged) {
    redirect(`/color/${slugged}`)
  }
  const displayColor = toTitleCase(slugged.replace(/-/g, ' '))
  const pills = await fetchPillsByColor(slugged)

  if (!displayColor) notFound()

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: `${displayColor} Pills`, url: `/color/${slugged}` },
  ])

  const hubJson = hubPageSchema({
    name: `${displayColor} Pills`,
    description: `Browse ${displayColor.toLowerCase()} pills identified by imprint, shape, and drug name using FDA data.`,
    url: `/color/${slugged}`,
    dateModified: new Date().toISOString(),
  })

  const relatedColors = ['white', 'yellow', 'orange', 'pink', 'blue', 'green', 'red', 'purple']
    .filter((c) => c !== slugged)
    .slice(0, 5)

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
            <li className="text-slate-700 font-medium">{displayColor} Pills</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">{displayColor} Pills</h1>

        <p className="text-slate-600 leading-relaxed mb-6 max-w-2xl">
          Looking for a {displayColor.toLowerCase()} pill? Browse our database of{' '}
          {displayColor.toLowerCase()} medications below. Each listing includes the imprint
          code, shape, drug name, and strength to help you accurately identify the pill.
          All data is sourced from the FDA NDC Directory and DailyMed.
        </p>

        {/* Related colors */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-600 mb-3">Browse by Color</h2>
          <div className="flex flex-wrap gap-2">
            {relatedColors.map((c) => (
              <Link
                key={c}
                href={`/color/${slugifyUrl(c)}`}
                className="text-sm bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full border border-slate-200 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 transition-colors"
              >
                {toTitleCase(c)} Pills
              </Link>
            ))}
          </div>
        </div>

        {/* Results */}
        {pills.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="text-4xl mb-4" role="img" aria-label="No results">🔍</div>
            <p className="text-slate-600">
              No {displayColor.toLowerCase()} pills found in our database.
            </p>
            <Link
              href="/search"
              className="mt-4 inline-block text-sky-600 hover:underline text-sm"
            >
              Try a manual search →
            </Link>
          </div>
        ) : (
          <>
            <p className="text-slate-500 text-sm mb-4">
              Showing {pills.length} {displayColor.toLowerCase()} pill{pills.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pills.map((pill, idx) => (
                <PillCard key={pill.ndc || pill.slug || idx} pill={pill} />
              ))}
            </div>
          </>
        )}

        {/* Related shapes */}
        <div className="mt-10 bg-sky-50 border border-sky-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-sky-800 mb-3">
            Narrow Your Search by Shape
          </h2>
          <div className="flex flex-wrap gap-2">
            {['round', 'oval', 'capsule', 'rectangle', 'square', 'triangle'].map((shape) => (
              <Link
                key={shape}
                href={`/shape/${slugifyUrl(shape)}`}
                className="text-sm bg-white text-sky-700 px-3 py-1.5 rounded-full border border-sky-200 hover:bg-sky-100 transition-colors"
              >
                {toTitleCase(shape)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
