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
  related: RelatedCondition[]
  redirect?: boolean
  canonical_slug?: string
}

interface ConditionListItem {
  slug: string
  title: string
  tag: string
}

async function fetchCondition(slug: string): Promise<ConditionData | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/condition/${encodeURIComponent(slug)}`,
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
  { params }: { params: Promise<{ tag: string }> }
) {
  const { tag } = await params
  const data = await fetchCondition(tag)

  // If the API says this is an alias, redirect to the canonical slug (301-equivalent).
  if (data?.redirect && data.canonical_slug) redirect(`/condition/${data.canonical_slug}`)
  // Truly missing or error
  if (!data) notFound()

  const { title, paragraphs, last_reviewed, drugs, related, slug } = data

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

      <div className="max-w-6xl mx-auto px-4 py-8">
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
        <div className="prose prose-slate max-w-3xl mb-8">
          {paragraphs.map((para, i) => (
            <p key={i} className="text-slate-700 leading-relaxed mb-4">{para}</p>
          ))}
        </div>

        {/* Drug grid */}
        <section aria-labelledby="drug-list-heading" className="mb-10">
          <h2 id="drug-list-heading" className="text-xl font-semibold text-slate-800 mb-4">
            Medications
          </h2>
          <ConditionPageClient drugs={drugs} conditionTitle={title} />
        </section>

        {/* Related conditions */}
        {related.length > 0 && (
          <section aria-labelledby="related-conditions-heading" className="mb-10">
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
