import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Droplet } from '../../../components/IvIcons'
import PillCard from '../../../components/PillCard'
import type { PillResult, SearchResponse } from '../../../types'
import { breadcrumbSchema, hubPageSchema, safeJsonLd } from '../../../lib/structured-data'
import { fetchIvForPillDrug } from '../../../lib/iv'
import { slugifyDrugName } from '../../../lib/slug'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export function toTitleCase(str: string): string {
  return str
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export type DrugSearchResult = {
  results: PillResult[]
  fallbackUsed: boolean
  fallbackTerm: string | null
}

const NO_RESULTS: DrugSearchResult = { results: [], fallbackUsed: false, fallbackTerm: null }
const ALL_PILLS_PER_PAGE = 100 // the API's maximum
const ALL_PILLS_MAX_PAGES = 6 // 600 rows; the biggest drug today has about 160

async function fetchSearchPage(term: string, page: number, perPage: number): Promise<SearchResponse | null> {
  try {
    const params = new URLSearchParams({ q: term, type: 'drug', per_page: String(perPage) })
    if (page > 1) params.set('page', String(page))
    const res = await fetch(`${API_BASE}/api/search?${params}`, {
      next: { revalidate: 3600 },
    })
    return res.ok ? ((await res.json()) as SearchResponse) : null
  } catch {
    return null
  }
}

async function searchDrug(term: string): Promise<DrugSearchResult> {
  const data = await fetchSearchPage(term, 1, 48)
  if (!data) return NO_RESULTS
  return {
    results: data.results,
    fallbackUsed: Boolean(data.fallback_used),
    fallbackTerm: data.fallback_term ?? null,
  }
}

/**
 * Every pill of the drug. The search API pages over database rows but returns one card per name + imprint, so a
 * single page of 48 rows showed 32 of lamotrigine's 65 imprints and the rest never appeared on this page.
 * `total` counts the name + imprint groups: keep asking until they are all here, or a page comes back empty.
 */
async function searchDrugAll(term: string): Promise<DrugSearchResult> {
  const first = await fetchSearchPage(term, 1, ALL_PILLS_PER_PAGE)
  if (!first) return NO_RESULTS
  const cards = new Map<string, PillResult>()
  const add = (pills: PillResult[]) => {
    for (const pill of pills) {
      // a group cut in two by a page boundary comes back on both pages: keep its first card. Same key the API groups
      // by (utils.normalize_name / normalize_imprint): "75;1171" and "1171 75" are one pill
      const imprint = (pill.imprint ?? '').trim().toUpperCase().split(/[;,\s]+/).filter(Boolean).sort().join(' ')
      const key = `${(pill.drug_name ?? '').trim().toLowerCase()}|${imprint}`
      if (!cards.has(key)) cards.set(key, pill)
    }
  }
  add(first.results)
  for (let page = 2; page <= ALL_PILLS_MAX_PAGES && cards.size < first.total; page++) {
    const next = await fetchSearchPage(term, page, ALL_PILLS_PER_PAGE)
    if (!next || next.results.length === 0) break
    add(next.results)
  }
  return {
    results: Array.from(cards.values()),
    fallbackUsed: Boolean(first.fallback_used),
    fallbackTerm: first.fallback_term ?? null,
  }
}

/**
 * Try the route param as-is first (handles legitimately hyphenated names like "co-trimoxazole").
 * If no results, fall back to replacing hyphens with spaces (handles slug-style URLs like
 * "mircette-28-dp-331" → "mircette 28 dp 331").
 */
export async function fetchPillsByDrug(name: string): Promise<DrugSearchResult> {
  const firstPass = await searchDrug(name)
  if (firstPass.results.length > 0) return firstPass
  const deSlugged = name.replace(/-/g, ' ')
  if (deSlugged === name) return firstPass
  return searchDrug(deSlugged)
}

async function fetchAllPillsByDrug(name: string): Promise<DrugSearchResult> {
  const firstPass = await searchDrugAll(name)
  if (firstPass.results.length > 0) return firstPass
  const deSlugged = name.replace(/-/g, ' ')
  if (deSlugged === name) return firstPass
  return searchDrugAll(deSlugged)
}

export async function generateMetadata(
  { params }: { params: Promise<{ name: string }> }
): Promise<Metadata> {
  const { name } = await params
  // Decode first so percent-encoded params (e.g. "ethambutol%20hydrochloride")
  // produce the correct canonical slug rather than encoding the % sign itself.
  const decoded = decodeURIComponent(name)
  const canonicalSlug = slugifyDrugName(decoded) || decoded
  const displayName = toTitleCase(canonicalSlug.replace(/-/g, ' '))
  const searchResult = await fetchAllPillsByDrug(decoded)
  const robots = searchResult.results.length >= 2
    ? { index: true, follow: true }
    : { index: false, follow: true }
  const title = `${displayName} Pills — Identify ${displayName} by Imprint, Color & Shape`
  const description = `Look up ${displayName} pills by imprint code, color, and shape. Find all ${displayName} medications in our FDA-powered pill identifier.`.slice(0, 155)

  return {
    title,
    description,
    robots,
    alternates: { canonical: `/drug/${canonicalSlug}` },
    openGraph: { title, description, url: `${SITE_URL}/drug/${canonicalSlug}` },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function DrugHubPage(
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  // Redirect legacy %20 URLs to hyphenated canonical slugs
  const decoded = decodeURIComponent(name)
  const canonicalSlug = slugifyDrugName(decoded) || decoded
  if (name !== canonicalSlug) {
    redirect(`/drug/${canonicalSlug}`)
  }
  const displayName = toTitleCase(canonicalSlug.replace(/-/g, ' '))
  const [searchResult, ivDrugs] = await Promise.all([fetchAllPillsByDrug(decoded), fetchIvForPillDrug(canonicalSlug)])
  const pills = searchResult.results

  if (!displayName) notFound()

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: displayName, url: `/drug/${canonicalSlug}` },
  ])

  const hubJson = hubPageSchema({
    name: `${displayName} Pill Identification`,
    description: `Browse all ${displayName} pills and identify them by imprint, color, and shape using FDA NDC data.`,
    url: `/drug/${canonicalSlug}`,
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

        <div className="mb-6">
          <Link
            href={`/drug/${canonicalSlug}/price`}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            View {displayName} NADAC Pricing
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        {/* only when a published IV drug has this same name (the API matches by name, never a combination pill) */}
        {ivDrugs.map((iv) => (
          <div key={iv.slug} className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700">
              <Droplet className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">Also given by IV</p>
              <p className="text-sm text-slate-600">How it is infused, mixing and storage, every strength, shortage and recalls.</p>
            </div>
            <Link href={`/iv/${iv.slug}`} className="whitespace-nowrap text-sm font-semibold text-teal-700 hover:underline">
              {iv.name} IV <span aria-hidden="true">→</span>
            </Link>
          </div>
        ))}

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
            {searchResult.fallbackUsed && searchResult.fallbackTerm && (
              <div className="bg-sky-50 border border-sky-200 text-sky-800 rounded-lg px-4 py-3 text-sm mb-4">
                ℹ️ No results found for &ldquo;{decoded}&rdquo;. Showing results for {searchResult.fallbackTerm} (generic equivalent).
              </div>
            )}
            <p className="text-slate-500 text-sm mb-4">
              Found {pills.length} {displayName} pill{pills.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pills.map((pill, idx) => (
                <PillCard key={`${pill.slug || pill.ndc || 'pill'}-${idx}`} pill={pill} />
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
