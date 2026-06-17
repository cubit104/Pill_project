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
import { cleanAdverseReactionsHtml } from './cleanAdverseReactionsHtml'

type PageParams = Promise<{ slug: string }>

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const ADVERSE_REACTIONS_REVALIDATE_SECONDS = 86400

type PillInfo = {
  drug_name?: string | null
  pronunciation?: string | null
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
  has_adverse_reactions?: boolean
}

type AdverseReactionsResponse = {
  drug_name?: string | null
  generic_name?: string | null
  brand_name?: string | null
  rxcui?: string | null
  ndc?: string | null
  spl_set_id?: string | null
  adverse_reactions?: string | null
  side_effects?: string | null
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
  adverseReactions,
  pill,
  slug,
}: {
  adverseReactions: AdverseReactionsResponse | null
  pill: PillInfo | null
  slug: string
}): string {
  if (pill?.medicine_name?.trim()) return formatDrugName(pill.medicine_name, false)
  const brand = adverseReactions?.brand_name?.trim() || null
  if (brand) return formatDrugName(brand, true)
  const fallback = firstNonEmpty(
    adverseReactions?.generic_name,
    adverseReactions?.drug_name,
    pill?.drug_name,
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

async function fetchAdverseReactions(slug: string): Promise<AdverseReactionsResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}/adverse-reactions`, {
      next: { revalidate: ADVERSE_REACTIONS_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null
    return (await res.json()) as AdverseReactionsResponse
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
  const adverseReactions = await fetchAdverseReactions(slug)
  const drugName = resolveDrugName({ adverseReactions, pill, slug })

  return {
    title: `${drugName} Adverse Reactions & Side Effects`,
    description: `Review adverse reactions and side effects reported for ${drugName}, based on FDA-approved prescribing information.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/adverse-reactions` },
  }
}

export default async function AdverseReactionsPage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const adverseReactionsData = await fetchAdverseReactions(slug)
  const drugName = resolveDrugName({ adverseReactions: adverseReactionsData, pill, slug })

  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({
    drugName: headerDrugName,
    pill,
    guide: adverseReactionsData
      ? {
          generic_name: adverseReactionsData.generic_name,
          brand_name: adverseReactionsData.brand_name,
          proprietary_name: null,
          drug_class: adverseReactionsData.drug_class,
          dosage_form: adverseReactionsData.dosage_form,
        }
      : null,
  })

  const encodedSlug = encodeURIComponent(slug)
  const cleanDrugSlug =
    slugifyDrugName(pill?.medicine_name || '') ||
    slugifyDrugName(drugName) ||
    encodedSlug
  const rxcui = adverseReactionsData?.rxcui ?? pill.rxcui
  const ndc = adverseReactionsData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const splSetId = adverseReactionsData?.spl_set_id ?? pill.spl_set_id

  const hasMedguide = Boolean(pill?.has_medguide)
  const hasSummary = !hasMedguide && Boolean(pill?.has_medication_summary)

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(cleanDrugSlug ? [{ name: drugName, url: `/drug/${cleanDrugSlug}` }] : []),
    { name: 'Adverse Reactions', url: `/pill/${encodedSlug}/adverse-reactions` },
  ])
  const pageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'adverse-reactions',
    rxcui,
    ndc,
    splSetId,
    genericName: adverseReactionsData?.generic_name,
    brandName: adverseReactionsData?.brand_name,
    fetchedAt: adverseReactionsData?.fetched_at,
  })

  const rawAdverseReactionsHtml =
    adverseReactionsData?.adverse_reactions?.trim() || adverseReactionsData?.side_effects?.trim() || null
  const adverseReactionsHtml = rawAdverseReactionsHtml
    ? sanitizeRenderedHtml(cleanAdverseReactionsHtml(rawAdverseReactionsHtml))
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
            {cleanDrugSlug && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link href={`/drug/${cleanDrugSlug}`} className="hover:text-sky-700 transition-colors">
                    {drugName}
                  </Link>
                </li>
              </>
            )}
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Adverse Reactions</li>
          </ol>
        </nav>

        <DrugPageHeader
          pageLabel="Adverse Reactions"
          drugName={headerDrugName}
          pronunciation={pill?.pronunciation}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="adverse"
          medicationGuideHref={`/pill/${encodedSlug}/medication-guide`}
          summaryHref={hasSummary ? `/pill/${encodedSlug}/medication-summary` : null}
          dosageHref={`/pill/${encodedSlug}/dosage`}
          adverseReactionsHref={`/pill/${encodedSlug}/adverse-reactions`}
          interactionsHref={`/pill/${encodedSlug}/interactions`}
          professionalHref={`/pill/${encodedSlug}/professional-information`}
        />

        <MedguideMetaBar guide={adverseReactionsData} />

        <div className="lg:max-w-[60rem] lg:mx-auto">
          <div className={SHARED_CONTENT_CARD_CLASSES}>
            {adverseReactionsHtml ? (
              <div className="[&_h3]:border-l-4 [&_h3]:border-emerald-500 [&_h3]:pl-3 [&_h3]:text-emerald-900">
                <article
                  id="adverse-reactions-content"
                  className={SHARED_READING_PROSE_CLASSES}
                  dangerouslySetInnerHTML={{ __html: adverseReactionsHtml }}
                />
              </div>
            ) : (
              <div className="text-center text-sm text-slate-600 py-8">
                Adverse reactions information is not available for this medication.
              </div>
            )}
          </div>
        </div>

        {(rxcui || ndc || adverseReactionsData?.fetched_at || adverseReactionsData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {rxcui && <p><span className="font-medium">RxCUI:</span> {rxcui}</p>}
            {ndc && <p><span className="font-medium">NDC:</span> {ndc}</p>}
            {adverseReactionsData?.fetched_at && (
              <p><span className="font-medium">Last fetched:</span>{' '}
                {new Date(adverseReactionsData.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </p>
            )}
            {adverseReactionsData?.source_url && (
              <p>
                <span className="font-medium">Source:</span>{' '}
                <a href={adverseReactionsData.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
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
