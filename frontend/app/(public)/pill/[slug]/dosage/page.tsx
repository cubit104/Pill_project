import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import { resolveHeaderMetadata } from '../medication-guide/headerMetadata'
import {
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from '../medication-guide/layoutStyles'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'
import { sanitizeRenderedHtml } from '../medication-guide/sanitizeRenderedHtml'

type PageParams = Promise<{ slug: string }>

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const DOSAGE_REVALIDATE_SECONDS = 86400

type PillInfo = {
  drug_name?: string | null
  spl_set_id?: string | null
  rxcui?: string | null
  ndc11?: string | null
  ndc9?: string | null
  medicine_name?: string | null
  brand_names?: string | null
  generic_name?: string | null
  brand_names_all?: string[] | null
  pharma_class?: string | null
  dosage_form?: string | null
  is_brand_row?: boolean
  brand_or_generic?: 'brand' | 'generic'
  has_medguide?: boolean
  has_medication_summary?: boolean
  has_dosage?: boolean
}

type DosageResponse = {
  drug_name?: string | null
  generic_name?: string | null
  brand_name?: string | null
  rxcui?: string | null
  ndc?: string | null
  spl_set_id?: string | null
  dosage_administration?: string | null
  dosage_forms_and_strengths?: string | null
  has_boxed_warning?: boolean
  drug_class?: string | null
  dosage_form?: string | null
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
  return trimmed.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase())
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
  const brand = dosage?.brand_name?.trim() || null
  if (brand) return formatDrugName(brand, true)
  const fallback = firstNonEmpty(
    dosage?.generic_name,
    dosage?.drug_name,
    pill?.drug_name,
    pill?.medicine_name,
    decodeURIComponent(slug).replace(/-/g, ' ')
  )
  return formatDrugName(fallback || 'Medication', false)
}

/**
 * Clean dosage HTML for patient-facing display:
 * 1. Remove the top-level <h2 id="dosage"> title (redundant with page header)
 * 2. Strip all <a> tags but keep their inner text
 * 3. Remove section number cross-references: (2.1), (5.1, 5.2), etc.
 * 4. Remove [see ...] bracketed cross-references (including italic <em> wrappers)
 */
function cleanDosageHtml(html: string): string {
  let clean = html

  clean = clean.replace(/<section[^>]*>/gi, '').replace(/<\/section>/gi, '')
  clean = clean.replace(/<h2[^>]*id="dosage"[^>]*>[\s\S]*?<\/h2>/gi, '')
  clean = clean.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
  clean = clean.replace(/\s*\(\d+\.\d+(?:[,\s]+\d+\.\d+)*\)/g, '')
  clean = clean.replace(/<em[^>]*>\s*\[see[\s\S]*?\]\s*<\/em>/gi, '')
  clean = clean.replace(/\[see[\s\S]*?\]/gi, '')
  clean = clean.replace(/<em[^>]*>\s*<\/em>/gi, '')
  clean = clean.replace(/\s{2,}/g, ' ').trim()

  return clean
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
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}/dosage`, {
      next: { revalidate: DOSAGE_REVALIDATE_SECONDS },
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
  const dosage = await fetchDosage(slug)
  const drugName = resolveDrugName({ dosage, pill, slug })
  const cleanSlug = slugifyDrugName(drugName) || encodeURIComponent(slug)

  return {
    title: `${drugName} Dosage & Administration – Recommended Doses | PillSeek`,
    description: `View recommended dosage and administration for ${drugName}, including adult doses, dosing adjustments, and FDA-approved prescribing instructions.`,
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

  const encodedSlug = encodeURIComponent(slug)
  const canonicalDrugSlug = slugifyDrugName(drugName) || encodedSlug
  const rxcui = dosageData?.rxcui ?? pill.rxcui
  const ndc = dosageData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const splSetId = dosageData?.spl_set_id ?? pill.spl_set_id

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(canonicalDrugSlug ? [{ name: drugName, url: `/drug/${canonicalDrugSlug}` }] : []),
    { name: 'Dosage', url: `/pill/${encodedSlug}/dosage` },
  ])
  const pageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'dosage',
    rxcui,
    ndc,
    splSetId,
    genericName: dosageData?.generic_name,
    brandName: dosageData?.brand_name,
    fetchedAt: dosageData?.fetched_at,
  })

  const rawDosageHtml = dosageData?.dosage_administration?.trim() || null
  const dosageHtml = rawDosageHtml
    ? sanitizeRenderedHtml(cleanDosageHtml(rawDosageHtml))
    : null

  return (
   <>
     <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
     <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(pageJsonLd) }} />
     <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
       <nav aria-label="Breadcrumb">
         <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li>
              <Link href="/" className="hover:text-sky-700 transition-colors">
                Home
              </Link>
            </li>
            {canonicalDrugSlug && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link href={`/drug/${canonicalDrugSlug}`} className="hover:text-sky-700 transition-colors">
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
          pageLabel="Dosage Guide"
          drugName={headerDrugName}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="dosage"
          medicationGuideHref={pill?.has_medguide ? `/pill/${encodedSlug}/medication-guide` : null}
          summaryHref={pill?.has_medication_summary ? `/pill/${encodedSlug}/medication-summary` : null}
          dosageHref={`/pill/${encodedSlug}/dosage`}
          professionalHref={`/pill/${encodedSlug}/professional-information`}
        />

        <MedguideMetaBar guide={dosageData} />

        <div className="lg:max-w-[60rem] lg:mx-auto">
          <div className={SHARED_CONTENT_CARD_CLASSES}>
            {dosageData?.dosage_forms_and_strengths && (
              <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="font-semibold text-slate-800">Dosage Form & Strength: </span>
                {dosageData.dosage_forms_and_strengths
                  .replace(/<[^>]+>/g, '')
                  .replace(/\s+/g, ' ')
                  .trim()}
              </div>
            )}
            {dosageHtml ? (
              <article
                id="dosage-content"
                className={SHARED_READING_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: dosageHtml }}
              />
            ) : (
              <div className="text-center text-sm text-slate-600 py-8">
                Dosage and administration information is not available for this medication.
              </div>
            )}
          </div>
        </div>

        {(rxcui || ndc || dosageData?.fetched_at || dosageData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {rxcui && <p><span className="font-medium">RxCUI:</span> {rxcui}</p>}
            {ndc && <p><span className="font-medium">NDC:</span> {ndc}</p>}
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
