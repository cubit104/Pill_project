import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import MedguideToc from './MedguideToc'
import MedguideMetaBar from './MedguideMetaBar'
import MedicationGuideTabs from './MedicationGuideTabs'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from './professionalTocConfig'
import { slugFromTag } from '../../../../lib/condition-utils'
import { slugifyDrugName } from '../../../../lib/slug'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const LINK_CLASSES = 'text-emerald-600 hover:underline'
const CONDITION_TITLE_PREFIX_RE = /^Medications for\s+/i
// Keep plain-text heading detection conservative so normal sentence lines still linkify;
// short title-like lines (up to 80 chars) are treated as headings and skipped.
const MAX_PLAIN_TEXT_HEADING_LENGTH = 80
const PLAIN_TEXT_HEADING_RE = new RegExp(
  `^[A-Z][A-Za-z0-9\\s'(),./:;!?&\\-]{0,${MAX_PLAIN_TEXT_HEADING_LENGTH}}$`
)

type PageParams = Promise<{ slug: string }>
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

type PillInfo = {
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string
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
  display_name?: string
  name?: string
  has_boxed_warning?: boolean
  has_medguide?: boolean
  sections: GuideSections
  medguide_html?: string | null
  boxed_warning_html?: string | null
  source_url?: string | null
  fetched_at?: string | null
  disclaimer?: string | null
}

type LinkTarget = {
  term: string
  href: string
}
type ConditionLink = {
  term: string
  slug: string
}
const SAFE_INTERNAL_PATH_RE = /^\/(?:drug|condition)\/[a-z0-9]+(?:-[a-z0-9]+)*$/

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

const MEDGUIDE_PROSE_CLASSES = [
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mb-4',
  '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mt-8 [&_h2]:mb-3',
  '[&_h3]:text-base [&_h3]:font-medium [&_h3]:text-slate-800 [&_h3]:mt-6 [&_h3]:mb-2',
  '[&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-700 [&_p]:my-3',
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-slate-700',
  '[&_a]:text-emerald-600 [&_a:hover]:underline',
  '[&_strong]:font-semibold [&_strong]:text-slate-800',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto',
  '[&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top',
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

function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out.sort((a, b) => b.length - a.length)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeLinkRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null
  return new RegExp(`(?<![A-Za-z0-9])(${terms.map(escapeRegex).join('|')})(?![A-Za-z0-9])`, 'gi')
}

function splitBrandNames(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[;,/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function buildLinkTargets({
  drugNames,
  conditionLinks,
}: {
  drugNames: string[]
  conditionLinks: ConditionLink[]
}): LinkTarget[] {
  const targets: LinkTarget[] = []

  for (const name of normalizeTerms(drugNames)) {
    const slug = slugifyDrugName(name)
    if (!slug) continue
    targets.push({ term: name, href: `/drug/${slug}` })
  }

  for (const { term, slug } of conditionLinks) {
    if (!slug) continue
    targets.push({ term, href: `/condition/${slug}` })
  }

  const deduped = new Map<string, LinkTarget>()
  for (const target of targets) {
    const key = target.term.toLowerCase()
    if (!deduped.has(key)) deduped.set(key, target)
  }
  return Array.from(deduped.values()).sort((a, b) => b.term.length - a.term.length)
}

function getSafeHref(href: string): string | null {
  try {
    const resolved = new URL(href, 'https://pillseek.com')
    if (resolved.origin !== 'https://pillseek.com') return null
    if (!SAFE_INTERNAL_PATH_RE.test(resolved.pathname)) return null
    return resolved.pathname
  } catch {
    return null
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function linkifyText(
  text: string,
  drugName: string,
  conditionTags: string[],
  additionalDrugNames: string[] = []
): ReactNode {
  if (!text) return text

  const targets = buildLinkTargets({
    drugNames: [drugName, ...additionalDrugNames],
    conditionLinks: normalizeTerms(conditionTags).map((tag) => ({
      term: tag,
      slug: slugFromTag(tag),
    })),
  })
  const regex = makeLinkRegex(targets.map((target) => target.term))
  if (!regex) return text

  const targetByTerm = new Map(targets.map((target) => [target.term.toLowerCase(), target]))
  const linkifyLine = (line: string, lineIndex: number): ReactNode => {
    const trimmed = line.trim()
    const startsWithCapital = /^[A-Z]/.test(trimmed)
    // Plain-text sections can contain inline subheadings; keep those unlinked while
    // still linkifying sentence-like body lines.
    const isHeadingLine =
      trimmed.length > 0 &&
      startsWithCapital &&
      !/[.!?]$/.test(trimmed) &&
      (trimmed.endsWith(':') || PLAIN_TEXT_HEADING_RE.test(trimmed))

    if (isHeadingLine) return line

    const parts: ReactNode[] = []
    let cursor = 0
    let linkKeyIndex = 0

    for (const match of line.matchAll(regex)) {
      if (match.index === undefined) continue
      const index = match.index
      if (index > cursor) parts.push(line.slice(cursor, index))

      const matchedText = match[0]
      const target = targetByTerm.get(matchedText.toLowerCase())
      const safeHref = target ? getSafeHref(target.href) : null
      if (target && safeHref) {
        parts.push(
          <Link key={`link-${lineIndex}-${linkKeyIndex}-${safeHref}`} href={safeHref} className={LINK_CLASSES}>
            {matchedText}
          </Link>
        )
        linkKeyIndex += 1
      } else {
        parts.push(matchedText)
      }
      cursor = index + matchedText.length
    }

    if (cursor < line.length) parts.push(line.slice(cursor))
    return <>{parts}</>
  }

  const parts: ReactNode[] = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    parts.push(linkifyLine(line, index))
    if (index < lines.length - 1) parts.push('\n')
  })
  return <>{parts}</>
}

function linkifyHtmlContent(content: string, targets: LinkTarget[]): string {
  if (!content || targets.length === 0) return content

  const regex = makeLinkRegex(targets.map((target) => target.term))
  if (!regex) return content

  const targetByTerm = new Map(targets.map((target) => [target.term.toLowerCase(), target]))
  // Preserve existing anchors and heading blocks so heading text never receives injected links.
  const protectedChunks = content.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<h[1-4]\b[^>]*>[\s\S]*?<\/h[1-4]>)/gi)

  return protectedChunks
    .map((chunk) => {
      if (/^<a\b/i.test(chunk) || /^<h[1-4]\b/i.test(chunk)) return chunk
      const tokens = chunk.split(/(<[^>]+>)/g)
      return tokens.map((token) => {
        if (token.startsWith('<')) return token
        return token.replace(regex, (match) => {
          const target = targetByTerm.get(match.toLowerCase())
          const safeHref = target ? getSafeHref(target.href) : null
          if (!target || !safeHref) return match
          return `<a href="${escapeHtml(safeHref)}" class="${LINK_CLASSES}">${escapeHtml(match)}</a>`
        })
      }).join('')
    })
    .join('')
}

function isHtmlContent(content: string): boolean {
  return /^<[a-z][a-z0-9-]*\b[^>]*>/i.test(content.trimStart())
}

function GuideHtml({ content, linkTargets }: { content: string; linkTargets: LinkTarget[] }) {
  return (
    <div
      className={MEDGUIDE_PROSE_CLASSES}
      dangerouslySetInnerHTML={{ __html: linkifyHtmlContent(content, linkTargets) }}
    />
  )
}

function GuideText({
  content,
  drugName,
  conditionTags,
  drugNames,
}: {
  content: string
  drugName: string
  conditionTags: string[]
  drugNames: string[]
}) {
  return (
    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
      {linkifyText(content, drugName, conditionTags, drugNames)}
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
}: {
  label: string
  content?: string | null
  drugName: string
  conditionTags: string[]
  drugNames: string[]
  linkTargets: LinkTarget[]
}) {
  if (!content) return null
  return (
    <section className="py-4 border-b border-slate-100 last:border-b-0">
      <h2 className="text-base font-semibold text-slate-800 mb-2">{label}</h2>
      {isHtmlContent(content) ? (
        <GuideHtml content={content} linkTargets={linkTargets} />
      ) : (
        <GuideText
          content={content}
          drugName={drugName}
          conditionTags={conditionTags}
          drugNames={drugNames}
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
}: {
  guide: GuideResponse | null
  hasRenderableSections: boolean
  drugName: string
  conditionTags: string[]
  drugNames: string[]
  linkTargets: LinkTarget[]
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
        />
      ))}
      {(!guide || !hasRenderableSections) && (
        <div className="text-center text-sm text-slate-600">Medication guide content is not available right now.</div>
      )}
    </div>
  )
}

function buildConditionLinks(conditions: ConditionListItem[]): ConditionLink[] {
  const links: ConditionLink[] = []
  for (const condition of conditions) {
    const term = condition.title.replace(CONDITION_TITLE_PREFIX_RE, '').trim()
    if (!term) continue
    links.push({
      term,
      slug: condition.slug || slugFromTag(term),
    })
  }
  return links
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
    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    const ndc = pill.ndc11 || pill.ndc9
    if (ndc) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc)}/guide?${params}`,
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
  const drugName = resolveDrugName({ guide: null, pill, slug })
  return {
    title: `Medication Guide — ${drugName}`,
    description: `Read the FDA Medication Guide for ${drugName}, including key warnings and patient counseling information.`,
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

  const [guideData, conditions] = await Promise.all([
    fetchGuide(pill, {
      includeProfessional: false,
      includeMedguide: true,
      includeBoxedWarning: true,
    }),
    fetchAllConditions(),
  ])

  const hasMedguide = Boolean(guideData?.has_medguide)
  const hasMedguideHtml = Boolean(guideData?.medguide_html?.trim())
  if (!guideData || (!hasMedguide && !hasMedguideHtml)) notFound()
  const drugName = resolveDrugName({ guide: guideData, pill, slug })
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

  const linkedMedguideHtml = guideData?.medguide_html
    ? linkifyHtmlContent(guideData.medguide_html, linkTargets)
    : null
  const linkedBoxedWarningHtml = guideData?.boxed_warning_html
    ? linkifyHtmlContent(guideData.boxed_warning_html, linkTargets)
    : null
  const hasConsumerToc =
    (linkedMedguideHtml?.match(/<h[23]\b[^>]*id=/gi)?.length ?? 0) >= MIN_PROFESSIONAL_TOC_SECTIONS

  const drugSlug = slugifyDrugName(drugName)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
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

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Medication Guide — {drugName}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Patient-friendly FDA guidance and safety information.
        </p>
      </div>

      <MedicationGuideTabs
        activeTab="consumer"
        medicationGuideHref={`/pill/${encodeURIComponent(slug)}/medication-guide`}
        professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
      />

      <div className="space-y-6">
        <MedguideMetaBar guide={guideData} />

        {guideData?.has_boxed_warning && (
          <details
            open
            className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800 [&[open]>summary]:mb-3"
          >
            <summary className="flex items-center gap-2 cursor-pointer font-semibold list-none [&::-webkit-details-marker]:hidden">
              <span aria-hidden>⚠️</span>
              <span>Boxed Warning</span>
            </summary>
            {linkedBoxedWarningHtml ? (
              <div
                className="text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold"
                dangerouslySetInnerHTML={{ __html: linkedBoxedWarningHtml }}
              />
            ) : (
              <p className="text-sm">
                This medication includes an FDA boxed warning. See the Full Prescribing Information for details.
              </p>
            )}
          </details>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800">
          <p className="font-semibold">Poison Help</p>
          <p className="text-sm mt-1 leading-relaxed">
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

        <div className={hasConsumerToc ? 'space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[10rem_1fr] lg:gap-8 lg:items-start' : 'space-y-6'}>
          {hasConsumerToc && (
            <aside className="no-print hidden lg:block lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto w-full lg:w-40">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <MedguideToc html={linkedMedguideHtml ?? ''} drugName={drugName} />
              </div>
            </aside>
          )}
          <div className="min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            {linkedMedguideHtml ? (
              <article
                id="medguide-content"
                className={MEDGUIDE_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: linkedMedguideHtml }}
              />
            ) : (
              <SectionFallback
                guide={guideData}
                hasRenderableSections={hasRenderableSections}
                drugName={drugName}
                conditionTags={conditionTags}
                drugNames={drugNames}
                linkTargets={linkTargets}
              />
            )}
          </div>
        </div>
      </div>

      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
        <p className="text-xs text-amber-700 leading-relaxed">
          This information is for educational purposes only and is not medical advice. Always consult your doctor,
          pharmacist, or other licensed healthcare professional before starting, stopping, or changing any medicine.{' '}
          <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
            Read full medical disclaimer
          </Link>
          .
        </p>
      </section>
    </div>
  )
}
