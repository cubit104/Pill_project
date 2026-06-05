import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import { resolveHeaderMetadata } from '../medication-guide/headerMetadata'
import InteractionsClient from './InteractionsClient'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'

type PageParams = Promise<{ slug: string }>

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const INTERACTIONS_REVALIDATE_SECONDS = 3600

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
  has_adverse_reactions?: boolean
}

type InteractionsSummaryResponse = {
  rxcui?: string | null
  generic_name?: string | null
  total?: number
  severity_summary?: {
    major?: number
    moderate?: number
    minor?: number
    unknown?: number
  }
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
  interactions,
  pill,
  slug,
}: {
  interactions: InteractionsSummaryResponse | null
  pill: PillInfo | null
  slug: string
}): string {
  const fallback = firstNonEmpty(
    pill?.drug_name,
    pill?.medicine_name,
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

async function fetchInteractionsSummary(drugName: string): Promise<InteractionsSummaryResponse | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/interactions/${encodeURIComponent(drugName)}?per_page=1`,
      { next: { revalidate: INTERACTIONS_REVALIDATE_SECONDS } }
    )
    if (!res.ok) return null
    return (await res.json()) as InteractionsSummaryResponse
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  const drugName = resolveDrugName({ interactions: null, pill, slug })
  const summary = await fetchInteractionsSummary(drugName)
  const total = summary?.total ?? 0
  const major = summary?.severity_summary?.major ?? 0
  const moderate = summary?.severity_summary?.moderate ?? 0

  return {
    title: `${drugName} Drug Interactions`,
    description: `There are ${total} drugs known to interact with ${drugName}. View all ${major} major, ${moderate} moderate interactions.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/interactions` },
  }
}

export default async function InteractionsPage({ params }: { params: PageParams }) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const drugName = resolveDrugName({ interactions: null, pill, slug })
  const interactionsSummary = await fetchInteractionsSummary(drugName)

  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({
    drugName: headerDrugName,
    pill,
    guide: {
      generic_name: interactionsSummary?.generic_name ?? null,
      brand_name: null,
      proprietary_name: null,
      drug_class: null,
      dosage_form: null,
    },
  })

  const encodedSlug = encodeURIComponent(slug)
  const cleanDrugSlug =
    slugifyDrugName(pill?.medicine_name || '') ||
    slugifyDrugName(drugName) ||
    encodedSlug

  const hasMedguide = Boolean(pill?.has_medguide)
  const hasSummary = !hasMedguide && Boolean(pill?.has_medication_summary)
  const total = interactionsSummary?.total ?? 0
  const severitySummary = {
    major: interactionsSummary?.severity_summary?.major ?? 0,
    moderate: interactionsSummary?.severity_summary?.moderate ?? 0,
    minor: interactionsSummary?.severity_summary?.minor ?? 0,
    unknown: interactionsSummary?.severity_summary?.unknown ?? 0,
  }

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(cleanDrugSlug ? [{ name: drugName, url: `/drug/${cleanDrugSlug}` }] : []),
    { name: 'Drug Interactions', url: `/pill/${encodedSlug}/interactions` },
  ])
  const pageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'interactions',
    rxcui: interactionsSummary?.rxcui ?? pill.rxcui,
    ndc: pill.ndc11 ?? pill.ndc9,
    splSetId: pill.spl_set_id,
    genericName: interactionsSummary?.generic_name,
    fetchedAt: null,
  })

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
            <li className="text-slate-700 font-medium">Drug Interactions</li>
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
          medicationGuideHref={`/pill/${encodedSlug}/medication-guide`}
          summaryHref={hasSummary ? `/pill/${encodedSlug}/medication-summary` : null}
          dosageHref={`/pill/${encodedSlug}/dosage`}
          adverseReactionsHref={`/pill/${encodedSlug}/adverse-reactions`}
          interactionsHref={`/pill/${encodedSlug}/interactions`}
          professionalHref={`/pill/${encodedSlug}/professional-information`}
        />

        <InteractionsClient
          drugName={drugName}
          genericName={interactionsSummary?.generic_name ?? pill.generic_name ?? null}
          rxcui={interactionsSummary?.rxcui ?? pill.rxcui ?? null}
          slug={slug}
          initialTotal={total}
          initialSeveritySummary={severitySummary}
        />

        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
          <p className="text-xs text-amber-700 leading-relaxed">
            This information is for educational purposes only and is not medical advice. Always consult your doctor,
            pharmacist, or other licensed healthcare professional before starting, stopping, or changing any medicine.{` `}
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
