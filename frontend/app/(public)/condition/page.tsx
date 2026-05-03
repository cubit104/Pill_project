import type { Metadata } from 'next'
import Link from 'next/link'
import { breadcrumbSchema, safeJsonLd } from '../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com'
).replace(/\/$/, '')

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Browse Medications by Condition — PillSeek',
  description:
    'Find medications for 32 common conditions including diabetes, high blood pressure, anxiety, and more. Free, FDA-sourced pill information.',
  alternates: { canonical: '/condition' },
  openGraph: {
    title: 'Browse Medications by Condition — PillSeek',
    description:
      'Find medications for 32 common conditions including diabetes, high blood pressure, anxiety, and more.',
    url: `${SITE_URL}/condition`,
    type: 'website',
    siteName: 'PillSeek',
  },
}

interface ConditionListItem {
  slug: string
  title: string
  tag: string
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

export default async function ConditionsIndexPage() {
  const conditions = await fetchAllConditions()

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: 'Conditions', url: `${SITE_URL}/condition` },
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}
      />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li><Link href="/" className="hover:text-sky-700">Home</Link></li>
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Conditions</li>
          </ol>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-3">
          Browse Medications by Condition
        </h1>
        <p className="text-slate-600 mb-8 max-w-2xl">
          Select a condition below to see all medications commonly prescribed for it.
          All data is sourced from the FDA NDC Directory and DailyMed.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {conditions.map((cond) => (
            <Link
              key={cond.slug}
              href={`/condition/${cond.slug}`}
              className="block p-4 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all"
            >
              <span className="font-semibold text-slate-900 text-sm">
                {cond.title.replace(/^Medications for\s+/i, '')}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
