import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import { resolveHeaderMetadata } from '../medication-guide/headerMetadata'
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
  has_adverse_reactions?: boolean
}

type AdverseReactionsResponse = {
  rxcui?: string
  ndc?: string
  generic_name?: string
  brand_name?: string
  proprietary_name?: string
  drug_class?: string | null
  dosage_form?: string | null
  display_name?: string
  name?: string
  adverse_reactions_html?: string | null
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
  adverseReactions,
  pill,
  slug,
}: {
  adverseReactions: AdverseReactionsResponse | null
  pill: PillInfo | null
  slug: string
}): string {
  // Pill API response (from /api/pill/{slug}) is authoritative
  const pillName = firstNonEmpty(pill?.drug_name, pill?.medicine_name)
  if (pillName) return formatDrugName(pillName, false)
  
  // Fall back to adverse reactions API fields
  const brand = adverseReactions?.brand_name?.trim() || null
  if (brand) return formatDrugName(brand, true)
  
  const fallback = firstNonEmpty(
    adverseReactions?.generic_name,
    adverseReactions?.display_name,
    adverseReactions?.name,
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

async function fetchAdverseReactions(
  pill: PillInfo
): Promise<AdverseReactionsResponse | null> {
  const params = new URLSearchParams({
    include_professional: 'false',
    include_medguide: 'false',
    include_boxed_warning: 'false',
  })

  try {
    if (pill.spl_set_id) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-setid/${encodeURIComponent(pill.spl_set_id)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as AdverseReactionsResponse
    }

    if (pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc11)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as AdverseReactionsResponse
    }

    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as AdverseReactionsResponse
    }

    if (pill.ndc9 && pill.ndc9 !== pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc9)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as AdverseReactionsResponse
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
  const drugName = resolveDrugName({ adverseReactions: null, pill, slug })

  return {
    title: `${drugName} Side Effects and Adverse Reactions`,
    description: `Side effects and adverse reactions of ${drugName}. Learn about common and serious side effects.`,
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

  const adverseReactionsData = await fetchAdverseReactions(pill)
  const drugName = resolveDrugName({ adverseReactions: adverseReactionsData, pill, slug })
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({ drugName: headerDrugName, pill })

  const drugSlug = slugifyDrugName(drugName)

  const arRxcui = adverseReactionsData?.rxcui ?? pill.rxcui
  const arNdc = adverseReactionsData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const arSplSetId = pill.spl_set_id

  const arPageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'adverse-reactions',
    rxcui: arRxcui,
    ndc: arNdc,
    splSetId: arSplSetId,
    genericName: adverseReactionsData?.generic_name,
    brandName: adverseReactionsData?.brand_name ?? adverseReactionsData?.proprietary_name,
    fetchedAt: adverseReactionsData?.fetched_at,
  })
  const arBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Adverse Reactions', url: `/pill/${encodeURIComponent(slug)}/adverse-reactions` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(arBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(arPageJsonLd) }} />

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
            <li className="text-slate-700 font-medium">Adverse Reactions</li>
          </ol>
        </nav>

        <DrugPageHeader
          pageLabel="Adverse Reactions"
          drugName={headerDrugName}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="adverse"
          medicationGuideHref={null}
          summaryHref={null}
          dosageHref={`/pill/${encodeURIComponent(slug)}/dosage`}
          adverseReactionsHref={`/pill/${encodeURIComponent(slug)}/adverse-reactions`}
          interactionsHref={`/pill/${encodeURIComponent(slug)}/interactions`}
          professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
        />

        <div className={SHARED_CONTENT_CARD_CLASSES}>
          {adverseReactionsData?.adverse_reactions_html ? (
            <article
              className={SHARED_READING_PROSE_CLASSES}
              dangerouslySetInnerHTML={{ __html: adverseReactionsData.adverse_reactions_html }}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm text-slate-800 mb-3">Adverse reactions information is not available.</p>
              {adverseReactionsData?.source_url && (
                <a
                  href={adverseReactionsData.source_url}
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

        {(arRxcui || arNdc || adverseReactionsData?.fetched_at || adverseReactionsData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {arRxcui && <p><span className="font-medium">RxCUI:</span> {arRxcui}</p>}
            {arNdc && <p><span className="font-medium">NDC:</span> {arNdc}</p>}
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
