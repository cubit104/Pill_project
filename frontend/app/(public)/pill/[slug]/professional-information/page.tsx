import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import ProfessionalToc from '../medication-guide/ProfessionalToc'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import { stripDoseFromName } from '../medication-guide/drugName'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from '../medication-guide/professionalTocConfig'
import {
  PRO_BOXED_WARNING_PROSE_CLASSES,
  PRO_HIGHLIGHTS_CONTAINER_CLASSES,
  PRO_HIGHLIGHTS_PROSE_CLASSES,
  SHARED_CONTENT_ASIDE_CLASSES,
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_CONTENT_GRID_CLASSES,
} from '../medication-guide/layoutStyles'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
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
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mb-4',
  '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mt-10 [&_h2]:mb-4',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:mt-8 [&_h3]:mb-3',
  '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:mt-5 [&_h4]:mb-2',
  '[&_p]:text-sm [&_p]:leading-8 [&_p]:text-slate-800 [&_p]:my-4',
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-4 [&_ul]:space-y-2',
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-4 [&_ol]:space-y-2',
  '[&_li]:text-sm [&_li]:leading-8 [&_li]:text-slate-800 [&_li]:my-2',
  '[&_a]:text-emerald-600 [&_a:hover]:underline',
  '[&_strong]:font-semibold [&_strong]:text-slate-900',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto',
  '[&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top',
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
  const isBrandPrimary = Boolean(guideData?.brand_name || guideData?.proprietary_name)

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
        genericName={guideData?.generic_name}
        brandName={guideData?.brand_name ?? guideData?.proprietary_name ?? pill.brand_names}
        drugClass={guideData?.drug_class}
        dosageForm={guideData?.dosage_form}
        isBrandPrimary={isBrandPrimary}
      />

      <MedicationGuideTabs
        activeTab="pro"
        medicationGuideHref={
          hasMedguide ? `/pill/${encodeURIComponent(slug)}/medication-guide` : null
        }
        summaryHref={
          hasMedicationSummaryFallback ? `/pill/${encodeURIComponent(slug)}/medication-summary` : null
        }
        professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
      />

      <MedguideMetaBar guide={guideData} />

      <div className="space-y-6">
        {hasProfessionalToc && (
          <details className="no-print lg:hidden bg-white border border-slate-200 rounded-xl shadow-sm p-4 [&[open]>summary]:mb-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 list-none [&::-webkit-details-marker]:hidden">
              On this page
            </summary>
            <ProfessionalToc sections={professionalTocSections} />
          </details>
        )}

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
                  dangerouslySetInnerHTML={{ __html: guideData.professional_highlights_html }}
                />
              </div>
            )}

            {guideData?.professional_html ? (
              <article
                id="pro-content"
                className={PRO_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: guideData.professional_html }}
              />
            ) : (
              <ProfessionalEmptyState guide={guideData} />
            )}
          </div>
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
