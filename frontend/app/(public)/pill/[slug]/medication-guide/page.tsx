import Link from 'next/link'
import { notFound } from 'next/navigation'
import MedguideToc from './MedguideToc'
import MedguideMetaBar from './MedguideMetaBar'

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
  has_boxed_warning?: boolean
  sections: GuideSections
  professional_html?: string | null
  medguide_html?: string | null
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
    : 'include_medguide=true&include_professional=false'

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
  const drugName = guide?.brand_name || guide?.generic_name || pill.medicine_name || 'Medication'
  const hasRenderableSections = SECTION_ORDER.some(({ key }) => Boolean(guide?.sections?.[key]))

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
        <div className="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8">
          {/* Left rail — sticky TOC on desktop, accordion on mobile */}
             <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
               {/* Desktop: bare TOC */}
               <div className="hidden lg:block no-print">
                 <MedguideToc html={guide?.medguide_html ?? ''} drugName={drugName} />
               </div>
               {/* Mobile: collapsible accordion */}
               <details className="lg:hidden no-print mb-4 border border-slate-200 rounded-xl overflow-hidden">
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
              <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
                <p className="font-semibold">⚠️ Boxed Warning</p>
                <p className="text-sm mt-1">This medication includes an FDA boxed warning.</p>
              </div>
            )}

            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <p className="font-semibold">Poison Help</p>
              <p className="text-sm mt-1">
                In the U.S., call Poison Control at{' '}
                <a href="tel:18002221222" className="underline">
                  1-800-222-1222
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
        <div>
          {guide?.professional_html ? (
            <>
              <iframe
                srcDoc={guide.professional_html}
                className="w-full border-0 rounded-xl shadow-sm"
                style={{ minHeight: '85vh' }}
                sandbox="allow-scripts"
                title={`${drugName} Full Prescribing Information`}
              />
              <div className="mt-4 text-sm text-slate-600">
                {guide.source_url && (
                  <a
                    href={guide.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sky-600 hover:underline"
                  >
                    View on DailyMed ↗
                  </a>
                )}
                <p className="mt-2">Source: FDA Structured Product Labeling via DailyMed</p>
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
              <p className="text-4xl mb-3">📄</p>
              <p className="text-lg font-semibold text-slate-800">Full Prescribing Information Not Available</p>
              <p className="text-sm text-slate-500 mt-2 mb-4">
                The structured product label could not be rendered.
              </p>
              {guide?.source_url && (
                <a
                  href={guide.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline"
                >
                  View on DailyMed ↗
                </a>
              )}
              <p className="mt-4 text-xs text-slate-500">Source: FDA Structured Product Labeling via DailyMed</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
