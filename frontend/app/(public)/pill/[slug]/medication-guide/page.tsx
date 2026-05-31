import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideToc from './MedguideToc'
import MedguideMetaBar from './MedguideMetaBar'
import MedicationGuideTabs from './MedicationGuideTabs'
import DrugPageHeader from './DrugPageHeader'
import ProfessionalToc from './ProfessionalToc'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from './professionalTocConfig'
import { resolveHeaderMetadata } from './headerMetadata'
import {
  PRO_BOXED_WARNING_PROSE_CLASSES,
  PRO_HIGHLIGHTS_CONTAINER_CLASSES,
  PRO_HIGHLIGHTS_PROSE_CLASSES,
  SHARED_CONTENT_ASIDE_CLASSES,
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_CONTENT_GRID_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from './layoutStyles'
import {
  type LinkTarget,
  type TermCounter,
  buildConditionLinks,
  buildLinkTargets,
  createTermCounter,
  linkifyHtmlContent,
  linkifyText,
  normalizeTerms,
  splitBrandNames,
} from './linkifyUtils'
import { sanitizeRenderedHtml } from './sanitizeRenderedHtml'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

type PageParams = Promise<{ slug: string }>
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

type PillInfo = {
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

type ConditionListItem = {
  slug: string
  title: string
  tag: string
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
  drug_class?: string | null
  dosage_form?: string | null
  display_name?: string
  name?: string
  has_boxed_warning?: boolean
  has_medguide?: boolean
  sections: GuideSections
  medguide_html?: string | null
  boxed_warning_html?: string | null
  professional_html?: string | null
  professional_highlights_html?: string | null
  professional_sections?: Array<[string, string]> | null
  source_url?: string | null
  fetched_at?: string | null
  disclaimer?: string | null
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

const PRO_PROSE_CLASSES = [
  SHARED_READING_PROSE_CLASSES,
  PRO_BOXED_WARNING_PROSE_CLASSES,
].join(' ')
const BOXED_WARNING_CARD_CLASSES =
  'rounded-xl border border-rose-300 border-l-4 border-l-rose-600 bg-rose-50 p-5 text-rose-950 [&[open]>summary]:mb-3'
const BOXED_WARNING_PROSE_CLASSES =
  'text-sm [&_.boxed-warning-content]:space-y-0 [&_.boxed-warning-content_h2]:mt-5 [&_.boxed-warning-content_h2]:mb-3 [&_.boxed-warning-content_h2]:text-base [&_.boxed-warning-content_h2]:font-semibold [&_.boxed-warning-content_h2]:text-rose-900 [&_.boxed-warning-content_h3]:mt-4 [&_.boxed-warning-content_h3]:mb-2 [&_.boxed-warning-content_h3]:text-sm [&_.boxed-warning-content_h3]:font-semibold [&_.boxed-warning-content_h3]:text-rose-900 [&_.boxed-warning-content_p]:my-3 [&_.boxed-warning-content_p]:leading-8 [&_.boxed-warning-content_p]:text-rose-950 [&_.boxed-warning-content_ul]:my-3 [&_.boxed-warning-content_ul]:list-disc [&_.boxed-warning-content_ul]:pl-5 [&_.boxed-warning-content_ul]:space-y-2 [&_.boxed-warning-content_ol]:my-3 [&_.boxed-warning-content_ol]:list-decimal [&_.boxed-warning-content_ol]:pl-5 [&_.boxed-warning-content_ol]:space-y-2 [&_.boxed-warning-content_li]:my-2 [&_.boxed-warning-content_li]:leading-8 [&_.boxed-warning-content_li]:text-rose-950 [&_.boxed-warning-content_a]:text-rose-800 [&_.boxed-warning-content_a:hover]:text-rose-950 [&_.boxed-warning-content_strong]:font-semibold [&_.boxed-warning-content_strong]:text-rose-950'

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
  const brand = firstNonEmpty(guide?.brand_name, guide?.proprietary_name)
  if (brand) return formatDrugName(brand, true)
  const fallback = firstNonEmpty(
    guide?.generic_name,
    guide?.display_name,
    guide?.name,
    pill?.medicine_name,
    decodeURIComponent(slug).replace(/-/g, ' ')
  )
  return formatDrugName(fallback || 'Medication', false)
}

function isHtmlContent(content: string): boolean {
  return /^<[a-z][a-z0-9-]*\b[^>]*>/i.test(content.trimStart())
}

function GuideHtml({
  content,
  linkTargets,
  counter,
}: {
  content: string
  linkTargets: LinkTarget[]
  counter?: TermCounter
}) {
  const sanitizedHtml = sanitizeRenderedHtml(linkifyHtmlContent(content, linkTargets, counter))
  return (
    <div
      className={SHARED_READING_PROSE_CLASSES}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
}

function GuideText({
  content,
  drugName,
  conditionTags,
  drugNames,
  counter,
}: {
  content: string
  drugName: string
  conditionTags: string[]
  drugNames: string[]
  counter?: TermCounter
}) {
  return (
    <p className="my-4 whitespace-pre-line text-sm leading-8 text-slate-800">
      {linkifyText(content, drugName, conditionTags, drugNames, counter)}
    </p>
  )
}

function SectionBlock({
  label,
  content,
  drugName,
  conditionTags,
  drugNames,
  linkTargets,
  counter,
}: {
  label: string
  content?: string | null
  drugName: string
  conditionTags: string[]
  drugNames: string[]
  linkTargets: LinkTarget[]
  counter?: TermCounter
}) {
  if (!content) return null
  return (
    <section className="border-b border-slate-100 py-5 last:border-b-0">
      <h2 className="mb-4 text-base font-semibold text-slate-900">{label}</h2>
      {isHtmlContent(content) ? (
        <GuideHtml content={content} linkTargets={linkTargets} counter={counter} />
      ) : (
        <GuideText
          content={content}
          drugName={drugName}
          conditionTags={conditionTags}
          drugNames={drugNames}
          counter={counter}
        />
      )}
    </section>
  )
}

function SectionFallback({
  guide,
  hasRenderableSections,
  drugName,
  conditionTags,
  drugNames,
  linkTargets,
  counter,
}: {
  guide: GuideResponse | null
  hasRenderableSections: boolean
  drugName: string
  conditionTags: string[]
  drugNames: string[]
  linkTargets: LinkTarget[]
  counter?: TermCounter
}) {
  return (
    <div>
      {SECTION_ORDER.map(({ key, label }) => (
        <SectionBlock
          key={key}
          label={label}
          content={guide?.sections?.[key]}
          drugName={drugName}
          conditionTags={conditionTags}
          drugNames={drugNames}
          linkTargets={linkTargets}
          counter={counter}
        />
      ))}
      {(!guide || !hasRenderableSections) && (
        <div className="text-center text-sm text-slate-600">Medication guide content is not available right now.</div>
      )}
    </div>
  )
}

type GuideFetchOptions = {
  includeProfessional: boolean
  includeMedguide: boolean
  includeBoxedWarning: boolean
}

function buildGuideQuery({
  includeProfessional,
  includeMedguide,
  includeBoxedWarning,
}: GuideFetchOptions): string {
  const params = new URLSearchParams()
  params.set('include_professional', includeProfessional ? 'true' : 'false')
  params.set('include_medguide', includeMedguide ? 'true' : 'false')
  params.set('include_boxed_warning', includeBoxedWarning ? 'true' : 'false')
  return params.toString()
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

async function fetchGuide(pill: PillInfo, options: GuideFetchOptions): Promise<GuideResponse | null> {
  const params = buildGuideQuery(options)

  try {
    if (pill.spl_set_id) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-setid/${encodeURIComponent(pill.spl_set_id)}/guide?${params}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc11)}/guide?${params}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.ndc9 && pill.ndc9 !== pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc9)}/guide?${params}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    return null
  } catch {
    return null
  }
}

async function fetchAllConditions(): Promise<ConditionListItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/conditions`, { next: { revalidate: 86400 } })
    if (!res.ok) return []
    const data = await res.json()
    return data.conditions ?? []
  } catch {
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  const guide = pill
    ? await fetchGuide(pill, {
        includeProfessional: false,
        includeMedguide: true,
        includeBoxedWarning: true,
      })
    : null
  const drugName = resolveDrugName({ guide, pill, slug })
  const hasMedicationGuideContent =
    Boolean(guide?.has_medguide) || Boolean(guide?.medguide_html?.trim())

  if (!hasMedicationGuideContent) {
    return {
      title: `${drugName} Professional Prescribing Information`,
      description: `View FDA prescribing information for ${drugName}, including indications, dosage, adverse reactions, contraindications, pharmacology, and counseling.`,
      alternates: { canonical: `/pill/${encodeURIComponent(slug)}/professional-information` },
      robots: { index: false, follow: true },
    }
  }

  return {
    title: `${drugName} Medication Guide, Warnings & FDA Label`,
    description: `Read the FDA Medication Guide for ${drugName}, including uses, dosage, side effects, warnings, and important safety information.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/medication-guide` },
  }
}

export default async function MedicationGuidePage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params

  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guideData = await fetchGuide(pill, {
    includeProfessional: false,
    includeMedguide: true,
    includeBoxedWarning: true,
  })

  const hasMedguide = Boolean(guideData?.has_medguide)
  const hasMedguideHtml = Boolean(guideData?.medguide_html?.trim())
  const hasMedicationGuideContent = hasMedguide || hasMedguideHtml

  const drugName = resolveDrugName({ guide: guideData, pill, slug })
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({ drugName: headerDrugName, pill, guide: guideData })
  const drugSlugForUnavailable = slugifyDrugName(drugName)
  const encodedSlug = encodeURIComponent(slug)

  if (!hasMedicationGuideContent) {
    // Fetch professional data server-side for immediate rendering
    const professionalData = await fetchGuide(pill, {
      includeProfessional: true,
      includeMedguide: false,
      includeBoxedWarning: false,
    })

    const professionalTocSections = (professionalData?.professional_sections ?? [])
      .map(([slugValue, labelValue]) => ({ slug: slugValue, label: labelValue }))
      .filter((section) => section.slug && section.label)
    const hasProfessionalToc = professionalTocSections.length >= MIN_PROFESSIONAL_TOC_SECTIONS
    const hasProfessionalContent = Boolean(
      professionalData?.professional_html?.trim() || professionalData?.professional_highlights_html?.trim()
    )
    const professionalHeaderMeta = resolveHeaderMetadata({
      drugName: headerDrugName,
      pill,
      guide: professionalData,
    })

    const proRxcui = professionalData?.rxcui ?? pill.rxcui
    const proNdc = professionalData?.ndc ?? pill.ndc11 ?? pill.ndc9
    const proSplSetId = pill.spl_set_id
    const proFetchedAt = professionalData?.fetched_at
    const proConditions = await fetchAllConditions()
    const proDrugNames = normalizeTerms([
      drugName,
      professionalData?.brand_name ?? '',
      professionalData?.generic_name ?? '',
      professionalData?.proprietary_name ?? '',
      professionalData?.display_name ?? '',
      professionalData?.name ?? '',
      pill.medicine_name ?? '',
      ...splitBrandNames(pill.brand_names),
    ])
    const proConditionLinks = buildConditionLinks(proConditions)
    const proLinkTargets = buildLinkTargets({ drugNames: proDrugNames, conditionLinks: proConditionLinks })
    const proSharedCounter = createTermCounter()
    const linkedProfessionalHtml = professionalData?.professional_html
      ? linkifyHtmlContent(professionalData.professional_html, proLinkTargets, proSharedCounter)
      : null
    const sanitizedProfessionalHighlightsHtml = professionalData?.professional_highlights_html
      ? sanitizeRenderedHtml(professionalData.professional_highlights_html)
      : null
    const sanitizedLinkedProfessionalHtml = linkedProfessionalHtml
      ? sanitizeRenderedHtml(linkedProfessionalHtml)
      : null

    const proPageJsonLd = guidePageSchema({
      drugName,
      slug,
      pageType: 'professional-information',
      rxcui: proRxcui,
      ndc: proNdc,
      splSetId: proSplSetId,
      genericName: professionalData?.generic_name,
      brandName: professionalData?.brand_name ?? professionalData?.proprietary_name,
      fetchedAt: proFetchedAt,
    })
    const proBreadcrumbs = breadcrumbSchema([
      { name: 'Home', url: '/' },
      ...(drugSlugForUnavailable ? [{ name: drugName, url: `/drug/${drugSlugForUnavailable}` }] : []),
      { name: 'Professional Information', url: `/pill/${encodedSlug}/professional-information` },
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
            {drugSlugForUnavailable && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link href={`/drug/${drugSlugForUnavailable}`} className="hover:text-sky-700 transition-colors">
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
          genericName={professionalHeaderMeta.genericName}
          brandName={professionalHeaderMeta.brandName}
          drugClass={professionalHeaderMeta.drugClass}
          dosageForm={professionalHeaderMeta.dosageForm}
          isBrandPrimary={professionalHeaderMeta.isBrandPrimary}
        />

        <MedicationGuideTabs
          activeTab="pro"
          medicationGuideHref={null}
          dosageHref={pill?.has_dosage ? `/pill/${encodedSlug}/dosage` : null}
          adverseReactionsHref={
            pill?.has_adverse_reactions ? `/pill/${encodedSlug}/adverse-reactions` : null
          }
          professionalHref={`/pill/${encodedSlug}/professional-information`}
        />

        <MedguideMetaBar guide={professionalData} />

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Medication Guide is not available for this medication, so full prescribing information is shown.
        </div>

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
              {professionalData?.professional_highlights_html && (
                <div className={`${PRO_HIGHLIGHTS_CONTAINER_CLASSES} mb-6`}>
                  <div
                    className={PRO_HIGHLIGHTS_PROSE_CLASSES}
                    dangerouslySetInnerHTML={{ __html: sanitizedProfessionalHighlightsHtml ?? '' }}
                  />
                </div>
              )}

              {professionalData?.professional_html ? (
                <article
                  id="pro-content"
                  className={PRO_PROSE_CLASSES}
                  dangerouslySetInnerHTML={{ __html: sanitizedLinkedProfessionalHtml ?? '' }}
                />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                  <p className="text-sm text-slate-800 mb-3">
                    Full prescribing information is not available for this medication in our cache.
                  </p>
                  {professionalData?.source_url && (
                    <a
                      href={professionalData.source_url}
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
          </div>
        </div>

        {!hasProfessionalContent && (
          <p className="text-xs text-slate-500">
            Professional information is currently unavailable; this page remains available for navigation and source links.
          </p>
        )}

        {(proRxcui || proNdc || proFetchedAt || professionalData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {proRxcui && <p><span className="font-medium">RxCUI:</span> {proRxcui}</p>}
            {proNdc && <p><span className="font-medium">NDC:</span> {proNdc}</p>}
            {proFetchedAt && (
              <p><span className="font-medium">Last fetched:</span>{' '}
                {new Date(proFetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </p>
            )}
            {professionalData?.source_url && (
              <p>
                <span className="font-medium">Source:</span>{' '}
                <a href={professionalData.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
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

  const conditions = await fetchAllConditions()
  const hasRenderableSections = SECTION_ORDER.some(({ key }) => Boolean(guideData?.sections?.[key]))

  const drugNames = normalizeTerms([
    drugName,
    guideData?.brand_name ?? '',
    guideData?.generic_name ?? '',
    guideData?.proprietary_name ?? '',
    guideData?.display_name ?? '',
    guideData?.name ?? '',
    pill.medicine_name ?? '',
    ...splitBrandNames(pill.brand_names),
  ])

  const conditionLinks = buildConditionLinks(conditions)
  const conditionTags = conditionLinks.map((condition) => condition.term)

  const linkTargets = buildLinkTargets({ drugNames, conditionLinks })
  const sharedLinkCounter = createTermCounter()
  const linkedBoxedWarningHtml = guideData?.boxed_warning_html
    ? linkifyHtmlContent(guideData.boxed_warning_html, linkTargets, sharedLinkCounter)
    : null

  const linkedMedguideHtml = guideData?.medguide_html
    ? linkifyHtmlContent(guideData.medguide_html, linkTargets, sharedLinkCounter)
    : null
  const sanitizedLinkedBoxedWarningHtml = linkedBoxedWarningHtml
    ? sanitizeRenderedHtml(linkedBoxedWarningHtml)
    : null
  const sanitizedLinkedMedguideHtml = linkedMedguideHtml
    ? sanitizeRenderedHtml(linkedMedguideHtml)
    : null
  const hasConsumerToc =
    (linkedMedguideHtml?.match(/<h[23]\b[^>]*id=/gi)?.length ?? 0) >= MIN_PROFESSIONAL_TOC_SECTIONS

  const drugSlug = slugifyDrugName(drugName)

  const guideRxcui = guideData?.rxcui ?? pill.rxcui
  const guideNdc = guideData?.ndc ?? pill.ndc11 ?? pill.ndc9
  const guideSplSetId = pill.spl_set_id

  const medguideJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'medication-guide',
    rxcui: guideRxcui,
    ndc: guideNdc,
    splSetId: guideSplSetId,
    genericName: guideData?.generic_name,
    brandName: guideData?.brand_name ?? guideData?.proprietary_name,
    fetchedAt: guideData?.fetched_at,
  })
  const medguideBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Medication Guide', url: `/pill/${encodeURIComponent(slug)}/medication-guide` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(medguideBreadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(medguideJsonLd) }} />
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
          <li className="text-slate-700 font-medium">Medication Guide</li>
        </ol>
      </nav>

      <DrugPageHeader
        pageLabel="Patient-Friendly FDA Guidance"
        drugName={headerDrugName}
        genericName={headerMeta.genericName}
        brandName={headerMeta.brandName}
        drugClass={headerMeta.drugClass}
        dosageForm={headerMeta.dosageForm}
        isBrandPrimary={headerMeta.isBrandPrimary}
      />

      <MedicationGuideTabs
        activeTab="consumer"
        medicationGuideHref={`/pill/${encodeURIComponent(slug)}/medication-guide`}
        dosageHref={pill?.has_dosage ? `/pill/${encodeURIComponent(slug)}/dosage` : null}
        adverseReactionsHref={
          pill?.has_adverse_reactions
            ? `/pill/${encodeURIComponent(slug)}/adverse-reactions`
            : null
        }
        professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
      />

      <div className="space-y-6">
        <MedguideMetaBar guide={guideData} />

        {guideData?.has_boxed_warning && (
          <details
            open
            className={BOXED_WARNING_CARD_CLASSES}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-rose-900 [&::-webkit-details-marker]:hidden">
              <span aria-hidden>⚠️</span>
              <span>Boxed Warning</span>
            </summary>
            {linkedBoxedWarningHtml ? (
              <div
                className={BOXED_WARNING_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: sanitizedLinkedBoxedWarningHtml ?? '' }}
              />
            ) : (
              <p className="text-sm leading-8 text-rose-950">
                This medication includes an FDA boxed warning. See the Full Prescribing Information for details.
              </p>
            )}
          </details>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800">
          <p className="font-semibold">Poison Help</p>
          <p className="text-sm mt-1 leading-8">
            If you suspect an overdose or accidental ingestion, call Poison Control:{' '}
            <a href="tel:18002221222" className="underline font-medium">
              1-800-222-1222
            </a>{' '}
            (free, 24/7, U.S.). For life-threatening symptoms, call{' '}
            <a href="tel:911" className="underline font-medium">
              911
            </a>
            .
          </p>
        </div>

        {hasConsumerToc && (
          <details className="no-print lg:hidden bg-white border border-slate-200 rounded-xl shadow-sm p-4 [&[open]>summary]:mb-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 list-none [&::-webkit-details-marker]:hidden">
              On this page
            </summary>
            <MedguideToc html={linkedMedguideHtml ?? ''} drugName={drugName} />
          </details>
        )}

        <div className={hasConsumerToc ? SHARED_CONTENT_GRID_CLASSES : 'space-y-6'}>
          {hasConsumerToc && (
            <aside className={SHARED_CONTENT_ASIDE_CLASSES}>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <MedguideToc html={linkedMedguideHtml ?? ''} drugName={drugName} />
              </div>
            </aside>
          )}
          <div className={`${SHARED_CONTENT_CARD_CLASSES} ${hasConsumerToc ? '' : 'lg:max-w-[60rem] lg:mx-auto'}`}>
            {linkedMedguideHtml ? (
              <article
                id="medguide-content"
                className={SHARED_READING_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: sanitizedLinkedMedguideHtml ?? '' }}
              />
            ) : (
              <SectionFallback
                guide={guideData}
                hasRenderableSections={hasRenderableSections}
                drugName={drugName}
                conditionTags={conditionTags}
                drugNames={drugNames}
                linkTargets={linkTargets}
                counter={sharedLinkCounter}
              />
            )}
          </div>
        </div>
      </div>

      {(guideRxcui || guideNdc || guideData?.fetched_at || guideData?.source_url) && (
        <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
          <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
          {guideRxcui && <p><span className="font-medium">RxCUI:</span> {guideRxcui}</p>}
          {guideNdc && <p><span className="font-medium">NDC:</span> {guideNdc}</p>}
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
