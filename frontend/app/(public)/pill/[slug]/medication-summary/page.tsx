import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import { SHARED_CONTENT_CARD_CLASSES } from '../medication-guide/layoutStyles'
import { hasSummarySections } from '../medication-guide/summarySections'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, safeJsonLd } from '../../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

type PageParams = Promise<{ slug: string }>

type PillInfo = {
  spl_set_id?: string
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string
}

type GuideSections = {
  overview?: string | null
  uses?: string | null
  dosage?: string | null
  how_to_take?: string | null
  side_effects?: string | null
  warnings?: string | null
  interactions?: string | null
  contraindications?: string | null
  special_populations?: string | null
  overdose?: string | null
  storage?: string | null
  pharmacology?: string | null
  manufacturer?: string | null
}

type GuideResponse = {
  rxcui?: string
  ndc?: string
  generic_name?: string
  brand_name?: string
  proprietary_name?: string
  display_name?: string
  name?: string
  has_medguide?: boolean
  sections?: GuideSections
  source_url?: string | null
  fetched_at?: string | null
}

const SECTION_ORDER: Array<{ key: keyof GuideSections; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'uses', label: 'Uses' },
  { key: 'dosage', label: 'Dosage' },
  { key: 'how_to_take', label: 'How To Take' },
  { key: 'side_effects', label: 'Side Effects' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'interactions', label: 'Interactions' },
  { key: 'contraindications', label: 'Contraindications' },
  { key: 'special_populations', label: 'Special Populations' },
  { key: 'overdose', label: 'Overdose' },
  { key: 'storage', label: 'Storage' },
  { key: 'pharmacology', label: 'Pharmacology' },
  { key: 'manufacturer', label: 'Manufacturer' },
]

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function formatDrugName(value: string, keepAllCaps: boolean): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (keepAllCaps && /^[A-Z0-9\s\-()]+$/.test(trimmed)) return trimmed
  return trimmed
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

function resolveDrugName({
  guide,
  pill,
  slug,
}: {
  guide: GuideResponse | null
  pill: PillInfo | null
  slug: string
}): string {
  const brand = firstNonEmpty(guide?.brand_name, guide?.proprietary_name)
  if (brand) return formatDrugName(brand, true)
  const fallback = firstNonEmpty(
    guide?.generic_name,
    guide?.display_name,
    guide?.name,
    pill?.medicine_name,
    pill?.brand_names,
    decodeURIComponent(slug).replace(/-/g, ' ')
  )
  return formatDrugName(fallback || 'Medication', false)
}

async function fetchPill(slug: string): Promise<PillInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, {
      next: { revalidate: PILL_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null
    return (await res.json()) as PillInfo
  } catch {
    return null
  }
}

async function fetchGuide(pill: PillInfo): Promise<GuideResponse | null> {
  const params = new URLSearchParams({
    include_professional: 'false',
    include_medguide: 'true',
    include_boxed_warning: 'false',
  })

  try {
    if (pill.spl_set_id) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-setid/${encodeURIComponent(pill.spl_set_id)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    const ndc = pill.ndc11 || pill.ndc9
    if (ndc) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    return null
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { slug } = await params
  const encodedSlug = encodeURIComponent(slug)
  const summaryPath = `/pill/${encodedSlug}/medication-summary`
  const pill = await fetchPill(slug)
  const guide = pill ? await fetchGuide(pill) : null
  const drugName = resolveDrugName({ guide, pill, slug })

  return {
    title: `${drugName} Medication Summary`,
    description: `Read a concise medication summary for ${drugName}, including uses, dosing, warnings, side effects, interactions, and storage details.`,
    alternates: { canonical: summaryPath },
  }
}

export default async function MedicationSummaryPage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const encodedSlug = encodeURIComponent(slug)
  const summaryPath = `/pill/${encodedSlug}/medication-summary`
  const professionalPath = `/pill/${encodedSlug}/professional-information`

  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guideData = await fetchGuide(pill)
  const drugName = resolveDrugName({ guide: guideData, pill, slug })
  const drugSlug = slugifyDrugName(drugName)
  const hasSummaryContent = hasSummarySections(guideData?.sections)
  const hasMedguide = Boolean(guideData?.has_medguide)

  const summaryJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: `${drugName} Medication Summary`,
    url: `${SITE_URL}${summaryPath}`,
    isPartOf: {
      '@type': 'WebSite',
      name: 'PillSeek',
      url: SITE_URL,
    },
    dateModified: guideData?.fetched_at || undefined,
  }
  const summaryBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Medication Summary', url: summaryPath },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(summaryBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(summaryJsonLd) }} />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li>
              <Link href="/" className="hover:text-sky-700 transition-colors">
                Home
              </Link>
            </li>
            {drugSlug && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link href={`/drug/${drugSlug}`} className="hover:text-sky-700 transition-colors">
                    {drugName}
                  </Link>
                </li>
              </>
            )}
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Medication Summary</li>
          </ol>
        </nav>

        <div>
          <h1 className="text-2xl font-bold text-slate-900">Medication Summary — {drugName}</h1>
          <p className="mt-2 text-sm text-slate-600">
            A quick patient-friendly summary of the most important medication details.
          </p>
        </div>

        <MedicationGuideTabs
          activeTab="summary"
          medicationGuideHref={summaryPath}
          medicationGuideLabel="Medication Summary"
          professionalHref={professionalPath}
        />

        {hasMedguide && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Looking for the full FDA patient leaflet?{' '}
            <Link href={`/pill/${encodedSlug}/medication-guide`} className="text-emerald-700 font-medium hover:underline">
              View Medication Guide
            </Link>
            .
          </div>
        )}

        <div className="space-y-6">
          <MedguideMetaBar guide={guideData} />
          <div className={`${SHARED_CONTENT_CARD_CLASSES} lg:max-w-[60rem] lg:mx-auto`}>
            {hasSummaryContent ? (
              <div>
                {SECTION_ORDER.map(({ key, label }) => {
                  const content = guideData?.sections?.[key]
                  if (!content?.trim()) return null
                  return (
                    <section key={key} className="border-b border-slate-100 py-5 last:border-b-0">
                      <h2 className="mb-4 text-base font-semibold text-slate-800">{label}</h2>
                      <p className="my-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{content}</p>
                    </section>
                  )
                })}
              </div>
            ) : (
              <div className="text-center text-sm text-slate-600">
                Medication summary content is not available right now.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
