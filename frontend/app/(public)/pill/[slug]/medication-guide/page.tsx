import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import MedguideMetaBar from './MedguideMetaBar'
import MedicationGuideTabs from './MedicationGuideTabs'
import { slugifyDrugName } from '../../../../lib/slug'
import { slugifyUrl } from '../../../../lib/url-utils'

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
  professional_html?: string | null
  professional_highlights_html?: string | null
  professional_sections?: Array<[string, string]> | null
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
  '[&_a]:text-sky-700 hover:[&_a]:underline',
  '[&_strong]:font-semibold [&_strong]:text-slate-800',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto',
  '[&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top',
].join(' ')

const PRO_PROSE_CLASSES = [
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mb-4',
  '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mt-8 [&_h2]:mb-3',
  '[&_h3]:text-base [&_h3]:font-medium [&_h3]:text-slate-800 [&_h3]:mt-6 [&_h3]:mb-2',
  '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:mt-5 [&_h4]:mb-2',
  '[&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-700 [&_p]:my-3',
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-slate-700',
  '[&_a]:text-sky-700 hover:[&_a]:underline',
  '[&_strong]:font-semibold [&_strong]:text-slate-800',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto',
  '[&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_th]:font-semibold [&_th]:text-left',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top',
].join(' ')

const PRO_HIGHLIGHTS_CONTAINER_CLASSES =
  'rounded-xl border border-sky-200 border-l-4 border-l-sky-600 bg-sky-50/60 p-5'
const PRO_HIGHLIGHTS_PROSE_CLASSES =
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mb-2 [&_h2]:mt-3 [&_p]:text-sm [&_p]:text-slate-700 [&_p]:leading-relaxed [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_li]:text-sm [&_li]:text-slate-700 [&_a]:text-sky-700 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-slate-800'

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
  conditionTags,
}: {
  drugNames: string[]
  conditionTags: string[]
}): LinkTarget[] {
  const targets: LinkTarget[] = []

  for (const name of normalizeTerms(drugNames)) {
    const slug = slugifyDrugName(name)
    if (!slug) continue
    targets.push({ term: name, href: `/drug/${slug}` })
  }

  for (const name of normalizeTerms(conditionTags)) {
    const slug = slugifyUrl(name)
    if (!slug) continue
    targets.push({ term: name, href: `/condition/${slug}` })
  }

  const deduped = new Map<string, LinkTarget>()
  for (const target of targets) {
    const key = target.term.toLowerCase()
    if (!deduped.has(key)) deduped.set(key, target)
  }
  return Array.from(deduped.values()).sort((a, b) => b.term.length - a.term.length)
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
    conditionTags,
  })
  const regex = makeLinkRegex(targets.map((target) => target.term))
  if (!regex) return text

  const targetByTerm = new Map(targets.map((target) => [target.term.toLowerCase(), target]))
  const parts: ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push(text.slice(cursor, index))

    const matchedText = match[0]
    const target = targetByTerm.get(matchedText.toLowerCase())
    if (target) {
      parts.push(
        <Link key={`${matchedText}-${index}`} href={target.href} className="text-sky-700 hover:underline">
          {matchedText}
        </Link>
      )
    } else {
      parts.push(matchedText)
    }
    cursor = index + matchedText.length
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function linkifyHtmlContent(content: string, targets: LinkTarget[]): string {
  if (!content || targets.length === 0) return content

  const regex = makeLinkRegex(targets.map((target) => target.term))
  if (!regex) return content

  const targetByTerm = new Map(targets.map((target) => [target.term.toLowerCase(), target]))
  const tokens = content.split(/(<[^>]+>)/g)
  let insideAnchor = false

  return tokens
    .map((token) => {
      if (token.startsWith('<')) {
        if (/^<a\b/i.test(token)) insideAnchor = true
        if (/^<\/a\b/i.test(token)) insideAnchor = false
        return token
      }

      if (insideAnchor) return token

      return token.replace(regex, (match) => {
        const target = targetByTerm.get(match.toLowerCase())
        if (!target) return match
        return `<a href="${target.href}" class="text-sky-700 hover:underline">${match}</a>`
      })
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

function ProfessionalEmptyState({ guide }: { guide: GuideResponse | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <p className="text-sm text-slate-600 mb-3">
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

async function fetchGuide(pill: PillInfo, isPro: boolean): Promise<GuideResponse | null> {
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
  return { title: `Medication Guide — ${drugName}` }
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

  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const [consumerGuide, professionalGuide, conditions] = await Promise.all([
    fetchGuide(pill, false),
    fetchGuide(pill, true),
    fetchAllConditions(),
  ])

  const hasMedguide = Boolean(consumerGuide?.has_medguide)
  const guideForName = consumerGuide ?? professionalGuide
  const drugName = resolveDrugName({ guide: guideForName, pill, slug })
  const hasRenderableSections = SECTION_ORDER.some(({ key }) => Boolean(consumerGuide?.sections?.[key]))
  const defaultTab = tab === 'pro' || !hasMedguide ? 'pro' : 'consumer'

  const drugNames = normalizeTerms([
    drugName,
    guideForName?.brand_name ?? '',
    guideForName?.generic_name ?? '',
    guideForName?.proprietary_name ?? '',
    guideForName?.display_name ?? '',
    guideForName?.name ?? '',
    pill.medicine_name ?? '',
    ...splitBrandNames(pill.brand_names),
  ])

  const conditionTags = normalizeTerms(
    conditions
      .map((condition) => condition.title.replace(/^Medications for\s+/i, '').trim())
      .filter(Boolean)
  )

  const linkTargets = buildLinkTargets({ drugNames, conditionTags })

  const linkedMedguideHtml = consumerGuide?.medguide_html
    ? linkifyHtmlContent(consumerGuide.medguide_html, linkTargets)
    : null
  const linkedBoxedWarningHtml = consumerGuide?.boxed_warning_html
    ? linkifyHtmlContent(consumerGuide.boxed_warning_html, linkTargets)
    : null
  const linkedProfessionalHighlightsHtml = professionalGuide?.professional_highlights_html
    ? linkifyHtmlContent(professionalGuide.professional_highlights_html, linkTargets)
    : null
  const linkedProfessionalHtml = professionalGuide?.professional_html
    ? linkifyHtmlContent(professionalGuide.professional_html, linkTargets)
    : null

  const drugSlug = slugifyDrugName(drugName)

  const consumerContent = (
    <div className="space-y-6">
      <MedguideMetaBar guide={consumerGuide} />

      {consumerGuide?.has_boxed_warning && (
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

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
        {linkedMedguideHtml ? (
          <article
            id="medguide-content"
            className={MEDGUIDE_PROSE_CLASSES}
            dangerouslySetInnerHTML={{ __html: linkedMedguideHtml }}
          />
        ) : (
          <SectionFallback
            guide={consumerGuide}
            hasRenderableSections={hasRenderableSections}
            drugName={drugName}
            conditionTags={conditionTags}
            drugNames={drugNames}
            linkTargets={linkTargets}
          />
        )}
      </div>
    </div>
  )

  const proContent = (
    <div className="space-y-6">
      <MedguideMetaBar guide={professionalGuide} />

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
        {linkedProfessionalHighlightsHtml && (
          <div className={`${PRO_HIGHLIGHTS_CONTAINER_CLASSES} mb-6`}>
            <div
              className={PRO_HIGHLIGHTS_PROSE_CLASSES}
              dangerouslySetInnerHTML={{ __html: linkedProfessionalHighlightsHtml }}
            />
          </div>
        )}

        {linkedProfessionalHtml ? (
          <article
            id="pro-content"
            className={PRO_PROSE_CLASSES}
            dangerouslySetInnerHTML={{ __html: linkedProfessionalHtml }}
          />
        ) : (
          <ProfessionalEmptyState guide={professionalGuide} />
        )}
      </div>
    </div>
  )

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
          {hasMedguide
            ? 'Patient-friendly guidance and full FDA prescribing information.'
            : 'Full FDA prescribing information.'}
        </p>
      </div>

      <MedicationGuideTabs
        hasMedguide={hasMedguide}
        defaultTab={defaultTab}
        consumerContent={consumerContent}
        proContent={proContent}
      />

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
