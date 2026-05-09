import Link from 'next/link'
import { notFound } from 'next/navigation'

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
  source_url?: string | null
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
  const include = isPro ? 'true' : 'false'

  try {
    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?include_professional=${include}`,
        { cache: 'no-store' }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    const ndc = pill.ndc11 || pill.ndc9
    if (ndc) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc)}/guide?include_professional=${include}`,
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

      <div className="flex border-b border-slate-200 mb-6">
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
        <>
          {guide?.has_boxed_warning && (
            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
              <p className="font-semibold">⚠️ Boxed Warning</p>
              <p className="text-sm mt-1">This medication includes an FDA boxed warning.</p>
            </div>
          )}

          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <p className="font-semibold">Poison Help</p>
            <p className="text-sm mt-1">
              In the U.S., call Poison Control at <a href="tel:18002221222" className="underline">1-800-222-1222</a>.
            </p>
          </div>

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
        </>
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
