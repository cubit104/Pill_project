import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { breadcrumbSchema, safeJsonLd } from '../../../lib/structured-data'
import ConditionPageClient from './ConditionPageClient'

export const revalidate = 86400

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

interface ConditionDrug {
  medicine_name: string
  spl_strength?: string | null
  slug?: string | null
  image_filename?: string | null
  image_url?: string | null
  brand_names?: string | null
  rxcui?: string | null
}

interface RelatedCondition {
  slug: string
  title: string
}

interface ConditionData {
  tag: string
  slug: string
  title: string
  paragraphs: string[]
  last_reviewed: string
  drugs: ConditionDrug[]
  drug_count: number
  total_count: number
  limit: number
  offset: number
  has_more: boolean
  related: RelatedCondition[]
  redirect?: boolean
  canonical_slug?: string
}

interface ConditionListItem {
  slug: string
  title: string
  tag: string
}

async function fetchCondition(
  slug: string,
  limit = 20,
  offset = 0,
): Promise<ConditionData | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/condition/${encodeURIComponent(slug)}?limit=${limit}&offset=${offset}`,
      { next: { revalidate } }
    )
    if (res.status === 404) return null
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function fetchAllConditions(): Promise<ConditionListItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/conditions`, { next: { revalidate } })
    if (!res.ok) return []
    const data = await res.json()
    return data.conditions ?? []
  } catch {
    return []
  }
}

export async function generateStaticParams() {
  const conditions = await fetchAllConditions()
  return conditions.map((c) => ({ tag: c.slug }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ tag: string }> }
): Promise<Metadata> {
  const { tag } = await params
  const data = await fetchCondition(tag)

  if (!data || data.redirect) {
    return {
      title: 'Condition Not Found',
      robots: { index: false, follow: true },
    }
  }

  const description = data.paragraphs[0]?.slice(0, 160) ?? ''
  const canonicalUrl = `${SITE_URL}/condition/${data.slug}`

  return {
    title: `${data.title} — PillSeek`,
    description,
    alternates: { canonical: `/condition/${data.slug}` },
    openGraph: {
      title: `${data.title} — PillSeek`,
      description,
      url: canonicalUrl,
      type: 'website',
      siteName: 'PillSeek',
    },
    twitter: { card: 'summary_large_image', title: `${data.title} — PillSeek`, description },
  }
}

export default async function ConditionPage(
  { params, searchParams }: {
    params: Promise<{ tag: string }>
    searchParams: Promise<{ page?: string }>
  }
) {
  const { tag } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)
  const limit = 20
  const offset = (page - 1) * limit

  const data = await fetchCondition(tag, limit, offset)

  // If the API says this is an alias, redirect to the canonical slug (301-equivalent),
  // preserving the current page number so deep links on alias URLs still work.
  if (data?.redirect && data.canonical_slug) {
    const pageQuery = page > 1 ? `?page=${page}` : ''
    redirect(`/condition/${data.canonical_slug}${pageQuery}`)
  }
  // Truly missing or error
  if (!data) notFound()

  const { title, paragraphs, last_reviewed, drugs, related, slug, total_count } = data
  const totalPages = total_count > 0 ? Math.ceil(total_count / limit) : 1

  // If the requested page is beyond the last valid page (e.g. ?page=999), redirect
  // to the last valid page so the user lands on real results, not an empty state.
  if (total_count > 0 && page > totalPages) {
    redirect(`/condition/${slug}?page=${totalPages}`)
  }

  // Condition name for MedicalCondition schema (strip "Medications for " prefix).
  const conditionName = title.replace(/^Medications for\s+/i, '')

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: 'Conditions', url: `${SITE_URL}/condition` },
    { name: title, url: `${SITE_URL}/condition/${slug}` },
  ])

  const medicalWebPage = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: title,
    about: { '@type': 'MedicalCondition', name: conditionName },
    url: `${SITE_URL}/condition/${slug}`,
    lastReviewed: last_reviewed,
    specialty: 'Pharmacology',
    description: paragraphs[0]?.slice(0, 300) ?? '',
  }

  const showPagination = total_count > limit
  const rangeStart = drugs.length > 0 ? offset + 1 : 0
  const rangeEnd = Math.min(offset + drugs.length, total_count)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(medicalWebPage) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li><Link href="/condition" className="hover:text-sky-700">Conditions</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">{conditionName}</li>
          </ol>
        </nav>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-slate-900 mb-6">{title}</h1>

        {/* Intro paragraphs */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6 mb-8">
          {paragraphs.map((para, i) => (
            <p key={i} className="text-slate-700 leading-relaxed mb-4 last:mb-0">{para}</p>
          ))}
        </div>

        {/* Drug grid */}
        <section aria-labelledby="drug-list-heading" className="mb-8">
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
            <h2 id="drug-list-heading" className="text-xl font-semibold text-slate-800 mb-4">
              Medications
            </h2>
            <ConditionPageClient drugs={drugs} conditionTitle={title} totalCount={total_count} />

            {/* Pagination controls */}
            {showPagination && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                  Showing {rangeStart}–{rangeEnd} of {total_count}
                </p>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={`/condition/${slug}?page=${page - 1}`}
                      className="px-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
                    >
                      ← Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/condition/${slug}?page=${page + 1}`}
                      className="px-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
                    >
                      Next →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Related conditions */}
        {related.length > 0 && (
          <section aria-labelledby="related-conditions-heading" className="mb-8">
            <h2 id="related-conditions-heading" className="text-xl font-semibold text-slate-800 mb-3">
              Related Conditions
            </h2>
            <div className="flex flex-wrap gap-2">
              {related.map((rel) => (
                <Link
                  key={rel.slug}
                  href={`/condition/${rel.slug}`}
                  className="inline-block px-4 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full text-sm hover:bg-emerald-100 transition-colors"
                >
                  {rel.title.replace(/^Medications for\s+/i, '')}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-amber-800 text-sm leading-relaxed">
            <strong>⚠️ Disclaimer:</strong> Information is general and not medical advice.
            Consult your healthcare provider before starting, changing, or stopping any
            medication.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
              Read full disclaimer
            </Link>
            .
          </p>
          {last_reviewed && (
            <p className="text-amber-700 text-xs mt-2">
              Last reviewed: {last_reviewed}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
