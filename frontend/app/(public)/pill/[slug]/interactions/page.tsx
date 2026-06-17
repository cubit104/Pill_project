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
const INTERACTIONS_CACHE_SECONDS = 86400 * 7

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
}

type InteractionsSummaryResponse = {
  drug_name?: string
  generic_name?: string | null
  rxcui?: string | null
  ndc?: string | null
  fetched_at?: string | null
  results?: Array<{
    drug_name: string
    severity: string | null
    description: string | null
  }>
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
  interactions,
  pill,
  slug,
}: {
  interactions: InteractionsSummaryResponse | null
  pill: PillInfo | null
  slug: string
}): string {
  // Pill API response (from /api/pill/{slug}) is authoritative
  const pillName = firstNonEmpty(pill?.drug_name, pill?.medicine_name)
  if (pillName) return formatDrugName(pillName, false)
  
  // Fall back to interactions API fields
  const fallback = firstNonEmpty(
    interactions?.drug_name,
    interactions?.generic_name,
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

async function fetchInteractions(
  slug: string
): Promise<InteractionsSummaryResponse | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/interactions/${encodeURIComponent(slug)}/summary`,
      { next: { revalidate: INTERACTIONS_CACHE_SECONDS } }
    )
    if (!res.ok) return null
    return (await res.json()) as InteractionsSummaryResponse
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
  const drugName = resolveDrugName({ interactions: null, pill, slug })

  return {
    title: `${drugName} Drug Interactions`,
    description: `Check for drug interactions with ${drugName}. Find major, moderate, and minor interactions with other medications.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/interactions` },
  }
}

export default async function InteractionsPage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const interactionsData = await fetchInteractions(slug)
  const drugName = resolveDrugName({ interactions: interactionsData, pill, slug })
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({ drugName: headerDrugName, pill })

  const drugSlug = slugifyDrugName(drugName)

  const interactionsPageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'interactions',
    rxcui: interactionsData?.rxcui,
    ndc: interactionsData?.ndc,
    genericName: interactionsData?.generic_name,
  })
  const interactionsBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Interactions', url: `/pill/${encodeURIComponent(slug)}/interactions` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(interactionsBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(interactionsPageJsonLd) }} />

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
            <li className="text-slate-700 font-medium">Interactions</li>
          </ol>
        </nav>

        <DrugPageHeader
          pageLabel="Drug Interactions"
          drugName={headerDrugName}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="interactions"
          medicationGuideHref={null}
          summaryHref={null}
          dosageHref={`/pill/${encodeURIComponent(slug)}/dosage`}
          adverseReactionsHref={`/pill/${encodeURIComponent(slug)}/adverse-reactions`}
          interactionsHref={`/pill/${encodeURIComponent(slug)}/interactions`}
          professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
        />

        <div className={SHARED_CONTENT_CARD_CLASSES}>
          {interactionsData?.results && interactionsData.results.length > 0 ? (
            <div className="space-y-4">
              {interactionsData.results.map((interaction, idx) => (
                <div
                  key={idx}
                  className="border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors"
                >
                  <h3 className="font-semibold text-slate-900 mb-2">{interaction.drug_name}</h3>
                  {interaction.severity && (
                    <p className="text-sm font-medium mb-2">
                      <span
                        className={`inline-block px-2 py-1 rounded ${
                          interaction.severity === 'major'
                            ? 'bg-red-100 text-red-800'
                            : interaction.severity === 'moderate'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {interaction.severity.charAt(0).toUpperCase() + interaction.severity.slice(1)}
                      </span>
                    </p>
                  )}
                  {interaction.description && (
                    <p className="text-sm text-slate-600">{interaction.description}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-slate-600">No interactions found for this medication.</p>
            </div>
          )}
        </div>

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
