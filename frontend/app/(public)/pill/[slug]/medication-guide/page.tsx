import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideToc from './MedguideToc'
import MedguideMetaBar from './MedguideMetaBar'
import ProfessionalToc from './ProfessionalToc'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from './professionalTocConfig'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'

type PageParams = Promise<{ slug: string }>
type SearchParams = Promise<{ tab?: string }>

type PillInfo = {
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string
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
  display_name?: string
  name?: string
  has_boxed_warning?: boolean
  sections: GuideSections
  professional_html?: string | null
  professional_highlights_html?: string | null
  professional_sections?: Array<[string, string]> | null
  medguide_html?: string | null
  boxed_warning_html?: string | null
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

// Tailwind prose classes for the rendered medguide article
const MEDGUIDE_PROSE_CLASSES = [
  'max-w-3xl',
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mb-4',
  '[&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-24',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:scroll-mt-24',
  '[&_p]:text-[15px] [&_p]:leading-7 [&_p]:text-slate-700 [&_p]:my-3',
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_ol]:space-y-1',
  '[&_li]:text-[15px] [&_li]:leading-7 [&_li]:text-slate-700',
  '[&_strong]:font-semibold [&_strong]:text-slate-900',
  '[&_em]:italic',
  '[&_.medguide-meta]:border-b [&_.medguide-meta]:border-slate-200 [&_.medguide-meta]:pb-3 [&_.medguide-meta]:mb-6',
  '[&_.medguide-approval]:text-xs [&_.medguide-approval]:text-slate-500 [&_.medguide-approval]:my-1',
  '[&_.medguide-revised]:text-xs [&_.medguide-revised]:text-slate-500 [&_.medguide-revised]:my-1',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4',
  '[&_table]:block [&_table]:overflow-x-auto',
  '[&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top',
  '[&_hr]:my-6 [&_hr]:border-slate-200',
].join(' ')
const PRO_TOC_GRID_CLASSES = 'lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8'

const PRO_PROSE_CLASSES = [
  'max-w-4xl',
  '[&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h2]:pb-2 [&_h2]:border-b [&_h2]:border-slate-200',
  '[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:scroll-mt-24',
  '[&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-slate-700 [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:scroll-mt-24',
  '[&_h5]:text-sm [&_h5]:font-semibold [&_h5]:text-slate-700 [&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:scroll-mt-24',
  '[&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-slate-700 [&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:scroll-mt-24',
  '[&_p]:text-[15px] [&_p]:leading-7 [&_p]:text-slate-700 [&_p]:my-3',
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_ol]:space-y-1',
  '[&_li]:text-[15px] [&_li]:leading-7 [&_li]:text-slate-700',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4 [&_table]:rounded-lg [&_table]:overflow-hidden',
  '[&_table]:block sm:[&_table]:table [&_table]:overflow-x-auto',
  '[&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top',
  '[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-4 [&_img]:border [&_img]:border-slate-200',
  '[&_figure]:my-6',
  '[&_figcaption]:text-sm [&_figcaption]:text-slate-500 [&_figcaption]:italic [&_figcaption]:mt-2 [&_figcaption]:text-center',
  '[&_p_a]:text-sky-700 [&_p_a]:underline [&_p_a]:underline-offset-2 hover:[&_p_a]:text-sky-900',
  '[&_li_a]:text-sky-700 [&_li_a]:underline [&_li_a]:underline-offset-2 hover:[&_li_a]:text-sky-900',
  '[&_strong]:font-semibold [&_strong]:text-slate-900',
].join(' ')

const PRO_HIGHLIGHTS_PROSE_CLASSES = [
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mt-4 [&_h2]:mb-2',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-3 [&_h3]:mb-1',
  '[&_p]:text-sm [&_p]:leading-6 [&_p]:text-slate-700 [&_p]:my-2',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1 [&_ul]:text-sm',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1 [&_ol]:text-sm',
  '[&_li]:text-sm [&_li]:leading-6 [&_li]:text-slate-700',
  '[&_strong]:font-semibold [&_strong]:text-slate-900',
  '[&_a]:text-sky-700 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-sky-900',
].join(' ')

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
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

function isHtmlContent(content: string): boolean {
  return /^<[a-z][a-z0-9-]*\b[^>]*>/i.test(content.trimStart())
}

function GuideHtml({ content }: { content: string }) {
  return (
    <div
      className={[
        '[&_ul]:list-disc [&_ul]:ml-4 [&_ul]:space-y-1 [&_ul]:my-2',
        '[&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:space-y-1 [&_ol]:my-2',
        '[&_li]:text-sm [&_li]:text-slate-700 [&_li]:leading-relaxed',
        '[&_p]:text-sm [&_p]:text-slate-700 [&_p]:leading-relaxed [&_p]:my-2',
        '[&_strong]:font-semibold [&_strong]:text-slate-800',
        '[&_em]:italic',
        '[&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:text-sm [&_h3]:mt-3 [&_h3]:mb-1',
        '[&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:text-sm [&_h4]:mt-3 [&_h4]:mb-1',
        '[&_hr]:border-slate-200 [&_hr]:my-4',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-3',
        '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:text-sm [&_td]:text-slate-700 [&_td]:align-top',
        '[&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:text-sm [&_th]:font-semibold [&_th]:bg-slate-50',
      ].join(' ')}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  )
}

function GuideText({ content }: { content: string }) {
  return <p className="text-slate-700 leading-7 whitespace-pre-line">{content}</p>
}

function SectionBlock({ label, content }: { label: string; content?: string | null }) {
  if (!content) return null
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">{label}</h2>
      {isHtmlContent(content) ? <GuideHtml content={content} /> : <GuideText content={content} />}
    </section>
  )
}

function SectionFallback({
  guide,
  hasRenderableSections,
}: {
  guide: GuideResponse | null
  hasRenderableSections: boolean
}) {
  return (
    <div className="space-y-4">
      {SECTION_ORDER.map(({ key, label }) => (
        <SectionBlock key={key} label={label} content={guide?.sections?.[key]} />
      ))}
      {(!guide || !hasRenderableSections) && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-600">
          Medication guide content is not available right now.
        </div>
      )}
    </div>
  )
}

function ProfessionalEmptyState({ guide }: { guide: GuideResponse | null }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      <p className="text-slate-600 mb-3">
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
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as PillInfo
  } catch {
    return null
  }
}

async function fetchGuide(
  pill: PillInfo,
  isPro: boolean
): Promise<GuideResponse | null> {
  const params = isPro
    ? 'include_professional=true'
    : 'include_medguide=true&include_professional=false&include_boxed_warning=true'

  try {
    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params}`,
        { cache: 'no-store' }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    const ndc = pill.ndc11 || pill.ndc9
    if (ndc) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc)}/guide?${params}`,
        { cache: 'no-store' }
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
  searchParams,
}: {
  params: PageParams
  searchParams: SearchParams
}): Promise<Metadata> {
  const { slug } = await params
  const { tab = 'consumer' } = await searchParams
  const isPro = tab === 'pro'
  const pill = await fetchPill(slug)
  const guide = pill ? await fetchGuide(pill, isPro) : null
  const drugName = resolveDrugName({ guide, pill, slug })
  const title = `Medication Guide — ${drugName}`
  return { title }
}

export default async function MedicationGuidePage({
  params,
  searchParams,
}: {
  params: PageParams
  searchParams: SearchParams
}) {
  const { slug } = await params
  const { tab = 'consumer' } = await searchParams
  const isPro = tab === 'pro'

  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guide = await fetchGuide(pill, isPro)
  const drugName = resolveDrugName({ guide, pill, slug })
  const hasRenderableSections = SECTION_ORDER.some(({ key }) => Boolean(guide?.sections?.[key]))
  const professionalSections = Array.isArray(guide?.professional_sections)
    ? guide.professional_sections.flatMap((entry) =>
        Array.isArray(entry) && entry.length >= 2
          ? [{ slug: String(entry[0]), label: String(entry[1]) }]
          : []
      )
    : []
  const hasProfessionalToc = professionalSections.length >= MIN_PROFESSIONAL_TOC_SECTIONS

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Medication Guide — {drugName}</h1>
        <p className="mt-2 text-slate-600 text-sm">
          Patient-friendly guidance and full FDA prescribing information.
        </p>
      </div>

      <div className="no-print flex border-b border-slate-200 mb-6">
        <Link
          href={`/pill/${slug}/medication-guide`}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            !isPro
              ? 'border-sky-600 text-sky-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          💊 Medication Guide
        </Link>
        <Link
          href={`/pill/${slug}/medication-guide?tab=pro`}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            isPro
              ? 'border-sky-600 text-sky-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          🏥 Full Prescribing Information
        </Link>
      </div>

      {!isPro && (
        <div className="lg:[&:has(nav)]:grid lg:[&:has(nav)]:grid-cols-[16rem_1fr] lg:[&:has(nav)]:gap-8">
          {/* Left rail — sticky TOC on desktop, accordion on mobile */}
          <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            {/* Desktop: bare TOC */}
            <div className="hidden lg:block no-print [&:not(:has(nav))]:!hidden">
              <MedguideToc html={guide?.medguide_html ?? ''} drugName={drugName} />
            </div>
            {/* Mobile: collapsible accordion */}
            <details className="lg:hidden no-print mb-4 border border-slate-200 rounded-xl overflow-hidden [&:not(:has(nav))]:!hidden">
              <summary className="px-4 py-3 text-sm font-medium text-slate-700 cursor-pointer select-none bg-white hover:bg-slate-50">
                On this page
              </summary>
              <div className="px-4 py-3 bg-white border-t border-slate-100">
                <MedguideToc html={guide?.medguide_html ?? ''} drugName={drugName} />
              </div>
            </details>
          </aside>

          {/* Content column */}
          <div className="space-y-6 min-w-0">
            <MedguideMetaBar guide={guide} />

            {guide?.has_boxed_warning && (
              <details
                open
                className="rounded-2xl border border-rose-300 bg-rose-50/60 px-5 py-4 [&[open]>summary]:mb-3"
              >
                <summary className="flex items-center gap-2 cursor-pointer text-rose-900 font-semibold list-none [&::-webkit-details-marker]:hidden">
                  <span aria-hidden>⚠️</span>
                  <span>Boxed Warning</span>
                  <span className="ml-auto text-xs font-normal text-rose-700/80">FDA</span>
                </summary>
                {guide?.boxed_warning_html ? (
                  <div
                    className="boxed-warning-prose text-sm text-rose-950 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold max-h-72 overflow-auto pr-2"
                    dangerouslySetInnerHTML={{ __html: guide.boxed_warning_html }}
                  />
                ) : (
                  <p className="text-sm text-rose-900/90">
                    This medication includes an FDA boxed warning. See the Full Prescribing Information for details.
                  </p>
                )}
              </details>
            )}

            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <p className="font-semibold">Poison Help</p>
              <p className="text-sm mt-1">
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

            {guide?.medguide_html ? (
              <article
                id="medguide-content"
                className={MEDGUIDE_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: guide.medguide_html }}
              />
            ) : (
              <SectionFallback guide={guide} hasRenderableSections={hasRenderableSections} />
            )}
          </div>
        </div>
      )}

      {isPro && (
        <>
          {guide?.professional_highlights_html && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 mb-6">
              <div
                className={PRO_HIGHLIGHTS_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: guide.professional_highlights_html }}
              />
            </div>
          )}

          {hasProfessionalToc ? (
            <div className={PRO_TOC_GRID_CLASSES}>
              <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                <div className="hidden lg:block no-print">
                  <ProfessionalToc sections={professionalSections} />
                </div>
                <details className="lg:hidden no-print mb-4 border border-slate-200 rounded-xl overflow-hidden">
                  <summary className="px-4 py-3 text-sm font-medium text-slate-700 cursor-pointer select-none bg-white hover:bg-slate-50">
                    On this page
                  </summary>
                  <div className="px-4 py-3 bg-white border-t border-slate-100">
                    <ProfessionalToc sections={professionalSections} />
                  </div>
                </details>
              </aside>

              <div className="space-y-6 min-w-0">
                <MedguideMetaBar guide={guide} />
                {guide?.professional_html ? (
                  <article
                    id="pro-content"
                    className={PRO_PROSE_CLASSES}
                    dangerouslySetInnerHTML={{ __html: guide.professional_html }}
                  />
                ) : (
                  <ProfessionalEmptyState guide={guide} />
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <MedguideMetaBar guide={guide} />
              {guide?.professional_html ? (
                <article
                  id="pro-content"
                  className={PRO_PROSE_CLASSES}
                  dangerouslySetInnerHTML={{ __html: guide.professional_html }}
                />
              ) : (
                <ProfessionalEmptyState guide={guide} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
