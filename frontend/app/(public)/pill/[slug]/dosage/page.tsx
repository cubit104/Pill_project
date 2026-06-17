import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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
  has_dosage?: boolean
}

type DosageResponse = {
  rxcui?: string
  ndc?: string
  generic_name?: string
  brand_name?: string
  proprietary_name?: string
  drug_class?: string | null
  dosage_form?: string | null
  display_name?: string
  name?: string
  dosage_html?: string | null
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
  dosage,
  pill,
  slug,
}: {
  dosage: DosageResponse | null
  pill: PillInfo | null
  slug: string
}): string {
  // Pill API response (from /api/pill/{slug}) is authoritative
  const pillName = firstNonEmpty(pill?.drug_name, pill?.medicine_name)
  if (pillName) return formatDrugName(pillName, false)
  
  // Fall back to dosage API fields
  const brand = dosage?.brand_name?.trim() || null
  if (brand) return formatDrugName(brand, true)
  
  const fallback = firstNonEmpty(
    dosage?.generic_name,
    dosage?.display_name,
    dosage?.name,
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

async function fetchDosage(slug: string): Promise<DosageResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/dosage/${encodeURIComponent(slug)}`, {
      next: { revalidate: GUIDE_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null
    return (await res.json()) as DosageResponse
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
  const drugName = resolveDrugName({ dosage: null, pill, slug })

  return {
    title: `${drugName} Dosage and Administration`,
    description: `How to take ${drugName}: dosage recommendations, administration instructions, and important precautions.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/dosage` },
  }
}

export default async function DosagePage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const dosageData = await fetchDosage(slug)
  const drugName = resolveDrugName({ dosage: dosageData, pill, slug })
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({
    drugName: headerDrugName,
    pill,
    guide: dosageData
      ? {
          generic_name: dosageData.generic_name,
          brand_name: dosageData.brand_name,
          proprietary_name: null,
          drug_class: dosageData.drug_class,
          dosage_form: dosageData.dosage_form,
        }
      : null,
  })

  const drugSlug = slugifyDrugName(drugName)

  const dosageRxcui = dosageData?.rxcui ?? pill.rxcui
  const dosageNdc = dosageData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const dosageSplSetId = pill.spl_set_id
  const sanitizedDosageHtml = dosageData?.dosage_html
    ? sanitizeRenderedHtml(dosageData.dosage_html)
    : null

  const dosagePageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'dosage',
    rxcui: dosageRxcui,
    ndc: dosageNdc,
    splSetId: dosageSplSetId,
    genericName: dosageData?.generic_name,
    brandName: dosageData?.brand_name,
    fetchedAt: dosageData?.fetched_at,
  })
  const dosageBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Dosage', url: `/pill/${encodeURIComponent(slug)}/dosage` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(dosageBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(dosagePageJsonLd) }} />

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
            <li className="text-slate-700 font-medium">Dosage</li>
          </ol>
        </nav>

        <DrugPageHeader
          pageLabel="Dosage and Administration"
          drugName={headerDrugName}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="dosage"
          medicationGuideHref={null}
          summaryHref={null}
          dosageHref={`/pill/${encodeURIComponent(slug)}/dosage`}
          adverseReactionsHref={`/pill/${encodeURIComponent(slug)}/adverse-reactions`}
          interactionsHref={`/pill/${encodeURIComponent(slug)}/interactions`}
          professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
        />

        <div className={SHARED_CONTENT_CARD_CLASSES}>
          {sanitizedDosageHtml ? (
            <article
              className={SHARED_READING_PROSE_CLASSES}
              dangerouslySetInnerHTML={{ __html: sanitizedDosageHtml }}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm text-slate-800">Dosage information is not available.</p>
            </div>
          )}
        </div>

        {(dosageRxcui || dosageNdc || dosageData?.fetched_at || dosageData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {dosageRxcui && <p><span className="font-medium">RxCUI:</span> {dosageRxcui}</p>}
            {dosageNdc && <p><span className="font-medium">NDC:</span> {dosageNdc}</p>}
            {dosageData?.fetched_at && (
              <p><span className="font-medium">Last fetched:</span>{' '}
                {new Date(dosageData.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </p>
            )}
            {dosageData?.source_url && (
              <p>
                <span className="font-medium">Source:</span>{' '}
                <a href={dosageData.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
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
