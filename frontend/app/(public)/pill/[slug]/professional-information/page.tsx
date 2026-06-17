import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import ProfessionalToc from '../medication-guide/ProfessionalToc'
import MobileTocBar from '../medication-guide/MobileTocBar'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from '../medication-guide/professionalTocConfig'
import { resolveHeaderMetadata } from '../medication-guide/headerMetadata'
import { sanitizeRenderedHtml } from '../medication-guide/sanitizeRenderedHtml'
import {
  PRO_BOXED_WARNING_PROSE_CLASSES,
  PRO_HIGHLIGHTS_CONTAINER_CLASSES,
  PRO_HIGHLIGHTS_PROSE_CLASSES,
  SHARED_CONTENT_ASIDE_CLASSES,
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_CONTENT_GRID_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from '../medication-guide/layoutStyles'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

type PageParams = Promise<{ slug: string }>

type PillInfo = {
  pronunciation?: string | null
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
  has_dosage?: boolean
  has_adverse_reactions?: boolean
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

const PRO_PROSE_CLASSES = [
  SHARED_READING_PROSE_CLASSES,
  PRO_BOXED_WARNING_PROSE_CLASSES,
].join(' ')

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
  if (pill?.medicine_name?.trim()) return formatDrugName(pill.medicine_name, false)
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

function ProfessionalEmptyState({ guide }: { guide: GuideResponse | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <p className="text-sm text-slate-800 mb-3">
        Full prescribing information is not available for this medication in our cache.
      </p>
      {guide?.source_url && (
        <a
          href={guide.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sky-700 font-semibold hover:text-sky-900"
        >
          View on DailyMed ↗
        </a>
      )}
    </div>
  )
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
    include_professional: 'true',
    include_medguide: 'false',
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
    title: `${drugName} Professional Prescribing Information`,
    description: `View FDA prescribing information for ${drugName}, including indications, dosage, adverse reactions, contraindications, pharmacology, and counseling.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/professional-information` },
  }
}

export default async function ProfessionalInformationPage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guideData = await fetchGuide(pill)
  const drugName = resolveDrugName({ guide: guideData, pill, slug })
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({ drugName: headerDrugName, pill, guide: guideData })

  const professionalTocSections = (guideData?.professional_sections ?? [])
    .map(([slugValue, labelValue]) => ({ slug: slugValue, label: labelValue }))
    .filter((section) => section.slug && section.label)
  const hasProfessionalToc = professionalTocSections.length >= MIN_PROFESSIONAL_TOC_SECTIONS
  const hasMedguide = Boolean(guideData?.has_medguide)
  const hasMedicationSummaryFallback = !hasMedguide && Boolean(
    guideData?.has_medication_summary || guideData?.medication_summary_html?.trim()
  )
  const hasProfessionalContent = Boolean(
    guideData?.professional_html?.trim() || guideData?.professional_highlights_html?.trim()
  )

  const drugSlug = slugifyDrugName(drugName)

  const proRxcui = guideData?.rxcui ?? pill.rxcui
  const proNdc = guideData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const proSplSetId = pill.spl_set_id
  const sanitizedProfessionalHighlightsHtml = guideData?.professional_highlights_html
    ? sanitizeRenderedHtml(guideData.professional_highlights_html)
    : null
  const sanitizedProfessionalHtml = guideData?.professional_html
    ? sanitizeRenderedHtml(guideData.professional_html)
    : null

  const proPageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'professional-information',
    rxcui: proRxcui,
    ndc: proNdc,
    splSetId: proSplSetId,
    genericName: guideData?.generic_name,
    brandName: guideData?.brand_name ?? guideData?.proprietary_name,
    fetchedAt: guideData?.fetched_at,
  })
  const proBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Professional Information', url: `/pill/${encodeURIComponent(slug)}/professional-information` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(proBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(proPageJsonLd) }} />

      {/* Sticky mobile TOC bar — slides in once user scrolls past sentinel, hides on scroll back up */}
      {hasProfessionalToc && (
        <MobileTocBar sentinelId="pro-toc-sentinel">
          <ProfessionalToc sections={professionalTocSections} layout="mobile-grid" />
        </MobileTocBar>
      )}

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
            <li className="text-slate-700 font-medium">Professional Information</li>
          </ol>
        </nav>

        <DrugPageHeader
          pageLabel="Full FDA Prescribing Details"
          drugName={headerDrugName}
          pronunciation={pill?.pronunciation}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="pro"
          medicationGuideHref={
            hasMedguide ? `/pill/${encodeURIComponent(slug)}/medication-guide` : null
          }
          summaryHref={
            hasMedicationSummaryFallback ? `/pill/${encodeURIComponent(slug)}/medication-summary` : null
          }
          dosageHref={`/pill/${encodeURIComponent(slug)}/dosage`}
          adverseReactionsHref={`/pill/${encodeURIComponent(slug)}/adverse-reactions`}
          interactionsHref={`/pill/${encodeURIComponent(slug)}/interactions`}
          professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
        />

        <MedguideMetaBar guide={guideData} />

        {/* Sentinel: when this scrolls out of view, the mobile sticky TOC bar appears */}
        <div id="pro-toc-sentinel" />

        <div className={hasProfessionalToc ? SHARED_CONTENT_GRID_CLASSES : 'space-y-6'}>
          {hasProfessionalToc && (
            <aside className={SHARED_CONTENT_ASIDE_CLASSES}>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <ProfessionalToc sections={professionalTocSections} />
              </div>
            </aside>
          )}
          <div className={`${SHARED_CONTENT_CARD_CLASSES} ${hasProfessionalToc ? '' : 'lg:max-w-[60rem] lg:mx-auto'}`}>
            {guideData?.professional_highlights_html && (
              <div className={`${PRO_HIGHLIGHTS_CONTAINER_CLASSES} mb-6`}>
                <div
                  className={PRO_HIGHLIGHTS_PROSE_CLASSES}
                  dangerouslySetInnerHTML={{ __html: sanitizedProfessionalHighlightsHtml ?? '' }}
                />
              </div>
            )}

            {guideData?.professional_html ? (
              <article
                id="pro-content"
                className={PRO_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: sanitizedProfessionalHtml ?? '' }}
              />
            ) : (
              <ProfessionalEmptyState guide={guideData} />
            )}
          </div>
        </div>

        {!hasProfessionalContent && (
          <p className="text-xs text-slate-500">
            Professional information is currently unavailable; this page remains available for navigation and source links.
          </p>
        )}

        {(proRxcui || proNdc || guideData?.fetched_at || guideData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {proRxcui && <p><span className="font-medium">RxCUI:</span> {proRxcui}</p>}
            {proNdc && <p><span className="font-medium">NDC:</span> {proNdc}</p>}
            {guideData?.fetched_at && (
              <p><span className="font-medium">Last fetched:</span>{' '}
                {new Date(guideData.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </p>
            )}
            {guideData?.source_url && (
              <p>
                <span className="font-medium">Source:</span>{' '}
                <a href={guideData.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
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
