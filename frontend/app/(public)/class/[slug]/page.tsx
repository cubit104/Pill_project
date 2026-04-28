import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { breadcrumbSchema, hubPageSchema, safeJsonLd } from '../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

interface ClassDrug {
  drug_name: string
  strength?: string
  slug: string
  color?: string
  shape?: string
  image_url?: string
}

interface ClassData {
  class_name: string
  slug: string
  count: number
  drugs: ClassDrug[]
}

async function fetchClass(classSlug: string): Promise<ClassData | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/class/${encodeURIComponent(classSlug)}`,
      { next: { revalidate: 86400 } }
    )
    if (res.status === 404) return null
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const data = await fetchClass(slug)
  if (!data) {
    return {
      title: 'Drug Class Not Found',
      robots: { index: false, follow: true },
    }
  }

  const { class_name, count } = data
  const title = `${class_name} — Drug List & Pill Identifier | PillSeek`
  const description = `View all ${count} medications classified as ${class_name}. Identify pills in this class by color, shape, imprint, or NDC. Free, FDA-sourced data.`.slice(0, 155)
  const canonicalUrl = `${SITE_URL}/class/${encodeURIComponent(slug)}`

  // noindex if only 1 drug (thin content)
  const robots = count >= 2
    ? { index: true, follow: true }
    : { index: false, follow: true }

  return {
    title,
    description,
    robots,
    alternates: { canonical: `/class/${encodeURIComponent(slug)}` },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'website',
      siteName: 'PillSeek',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ClassHubPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const data = await fetchClass(slug)
  if (!data) notFound()

  const { class_name, count, drugs } = data

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: class_name, url: `/class/${encodeURIComponent(slug)}` },
  ])

  const hubJson = hubPageSchema({
    name: `${class_name} Medications`,
    description: `Browse all ${count} medications in the ${class_name} pharmacologic class.`,
    url: `/class/${encodeURIComponent(slug)}`,
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
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">{class_name}</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-4">{class_name}</h1>

        <p className="text-slate-600 leading-relaxed mb-6 max-w-2xl">
          This page lists all {count} medication{count !== 1 ? 's' : ''} in the{' '}
          <strong>{class_name}</strong> pharmacologic class. Use PillSeek to identify any
          pill in this class by imprint code, color, shape, or NDC number. All data is
          sourced from the FDA NDC Directory and DailyMed.
        </p>

        <p className="text-slate-500 text-sm mb-4">
          {count} medication{count !== 1 ? 's' : ''} in this class
        </p>

        {/* Drug grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-10">
          {drugs.map((drug) => (
            <Link
              key={drug.slug}
              href={`/pill/${encodeURIComponent(drug.slug)}`}
              className="block p-4 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all"
            >
              <div className="font-semibold text-slate-900 text-sm">{drug.drug_name}</div>
              {drug.strength && (
                <div className="text-xs text-slate-500 mt-0.5">{drug.strength}</div>
              )}
              {(drug.color || drug.shape) && (
                <div className="text-xs text-slate-400 mt-1">
                  {[drug.color, drug.shape].filter(Boolean).join(' • ')}
                </div>
              )}
            </Link>
          ))}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
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
