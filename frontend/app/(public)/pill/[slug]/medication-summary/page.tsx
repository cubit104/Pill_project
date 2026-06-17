import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import { resolveHeaderMetadata } from '../medication-guide/headerMetadata'
import { sanitizeRenderedHtml } from '../medication-guide/sanitizeRenderedHtml'
import {
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from '../medication-guide/layoutStyles'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

type PageParams = Promise<{ slug: string }>

type PillInfo = {
  drug_name?: string | null
  spl_set_id?: string
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string | null
  generic_name?: string | null
  brand_names_all?: string[] | null
  pharma_class?: string | null
  dosage_form?: string | null
  is_brand_row?: boolean
  brand_or_generic?: 'brand' | 'generic'
  has_medication_summary?: boolean
}

type GuideResponse = {
  rxcui?: string
  ndc?: string
  generic_name?: string
  brand_name?: string
  proprietary_name?: string
  drug_class?: string | null
  dosage_form?: string | null
  display_name?: string
  name?: string
  has_medguide?: boolean
  has_medication_summary?: boolean
  medication_summary_html?: string | null
  professional_html?: string | null
  professional_highlights_html?: string | null
  professional_sections?: Array<[string, string]> | null
  source_url?: string | null
  fetched_at?: string | null
}

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

function stripDoseFromName(name: string): string {
  return name.replace(/\s+\d[\d./]*\s*(mg|mcg|ml|g|%|units?|iu|meq)\s*$/i, '').trim()
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
  // Pill API response (from /api/pill/{slug}) is authoritative
  const pillName = firstNonEmpty(pill?.drug_name, pill?.medicine_name)
  if (pillName) return formatDrugName(pillName, false)
  
  // Fall back to guide API fields
  const brand = firstNonEmpty(guide?.brand_name, guide?.proprietary_name)
  if (brand) return formatDrugName(brand, true)
  
  const fallback = firstNonEmpty(
    guide?.generic_name,
    guide?.display_name,
    guide?.name,
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

async function fetchSummary(pill: PillInfo): Promise<GuideResponse | null> {
  const params = new URLSearchParams({
    include_professional: 'false',
    include_medguide: 'false',
  })

  try {
    if (pill.spl_set_id) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-setid/${encodeURIComponent(pill.spl_set_id)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc11)}/guide?${params.toString()}`,
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

    if (pill.ndc9 && pill.ndc9 !== pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc9)}/guide?${params.toString()}`,
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
  const pill = await fetchPill(slug)
  const drugName = resolveDrugName({ guide: null, pill, slug })

  return {
    title: `${drugName} Medication Summary`,
    description: `Consumer-friendly summary of ${drugName}, including uses, warnings, and side effects.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/medication-summary` },
  }
}

export default async function MedicationSummaryPage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const summaryData = await fetchSummary(pill)
  if (!summaryData?.has_medication_summary) notFound()

  const drugName = resolveDrugName({ guide: summaryData, pill, slug })
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({ drugName: headerDrugName, pill, guide: summaryData })

  const drugSlug = slugifyDrugName(drugName)

  const summaryRxcui = summaryData?.rxcui ?? pill.rxcui
  const summaryNdc = summaryData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const summarySplSetId = pill.spl_set_id
  const sanitizedSummaryHtml = summaryData?.medication_summary_html
    ? sanitizeRenderedHtml(summaryData.medication_summary_html)
    : null

  const summaryPageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'medication-summary',
    rxcui: summaryRxcui,
    ndc: summaryNdc,
    splSetId: summarySplSetId,
    genericName: summaryData?.generic_name,
    brandName: summaryData?.brand_name ?? summaryData?.proprietary_name,
    fetchedAt: summaryData?.fetched_at,
  })
  const summaryBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Medication Summary', url: `/pill/${encodeURIComponent(slug)}/medication-summary` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(summaryBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(summaryPageJsonLd) }} />

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

        <DrugPageHeader
          pageLabel="Medication Summary"
          drugName={headerDrugName}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="summary"
          medicationGuideHref={null}
          summaryHref={`/pill/${encodeURIComponent(slug)}/medication-summary`}
          dosageHref={`/pill/${encodeURIComponent(slug)}/dosage`}
          adverseReactionsHref={`/pill/${encodeURIComponent(slug)}/adverse-reactions`}
          interactionsHref={`/pill/${encodeURIComponent(slug)}/interactions`}
          professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
        />

        <MedguideMetaBar guide={summaryData} />

        <div className={SHARED_CONTENT_CARD_CLASSES}>
          {sanitizedSummaryHtml ? (
            <article
              className={SHARED_READING_PROSE_CLASSES}
              dangerouslySetInnerHTML={{ __html: sanitizedSummaryHtml }}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm text-slate-800 mb-3">Medication summary is not available.</p>
              {summaryData?.source_url && (
                <a
                  href={summaryData.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sky-700 font-semibold hover:text-sky-900"
                >
                  View on DailyMed ↗
                </a>
              )}
            </div>
          )}
        </div>

        {(summaryRxcui || summaryNdc || summaryData?.fetched_at || summaryData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {summaryRxcui && <p><span className="font-medium">RxCUI:</span> {summaryRxcui}</p>}
            {summaryNdc && <p><span className="font-medium">NDC:</span> {summaryNdc}</p>}
            {summaryData?.fetched_at && (
              <p><span className="font-medium">Last fetched:</span>{' '}
                {new Date(summaryData.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </p>
            )}
            {summaryData?.source_url && (
              <p>
                <span className="font-medium">Source:</span>{' '}
                <a href={summaryData.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                  DailyMed ↗
                </a>
              </p>
            )}
          </section>
        )}

        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
          <p className="text-xs text-amber-700 leading-8">
            This information is for educational purposes only and is not medical advice. Always consult your doctor,
            pharmacist, or other licensed healthcare professional before starting, stopping, or changing any medicine.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
              Read full medical disclaimer
            </Link>
            .
          </p>
        </section>
      </div>
    </>
  )
}
