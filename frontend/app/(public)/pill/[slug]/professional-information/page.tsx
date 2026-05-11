import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import ProfessionalToc from '../medication-guide/ProfessionalToc'
import { MIN_PROFESSIONAL_TOC_SECTIONS } from '../medication-guide/professionalTocConfig'
import { slugifyDrugName } from '../../../../lib/slug'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

type PageParams = Promise<{ slug: string }>

type PillInfo = {
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string
}

type GuideResponse = {
  generic_name?: string
  brand_name?: string
  proprietary_name?: string
  display_name?: string
  name?: string
  has_medguide?: boolean
  professional_html?: string | null
  professional_highlights_html?: string | null
  professional_sections?: Array<[string, string]> | null
  source_url?: string | null
  fetched_at?: string | null
}

const PRO_PROSE_CLASSES = [
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mb-4',
  '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mt-8 [&_h2]:mb-3',
  '[&_h3]:text-base [&_h3]:font-medium [&_h3]:text-slate-800 [&_h3]:mt-6 [&_h3]:mb-2',
  '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:mt-5 [&_h4]:mb-2',
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

const PRO_HIGHLIGHTS_CONTAINER_CLASSES =
  'rounded-xl border border-sky-200 border-l-4 border-l-sky-600 bg-sky-50/60 p-5'
const PRO_HIGHLIGHTS_PROSE_CLASSES =
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mb-2 [&_h2]:mt-3 [&_p]:text-sm [&_p]:text-slate-700 [&_p]:leading-relaxed [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_li]:text-sm [&_li]:text-slate-700 [&_a]:text-emerald-600 [&_a:hover]:underline [&_strong]:font-semibold [&_strong]:text-slate-800'

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
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}`, {
      next: { revalidate: PILL_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null
    return (await res.json()) as PillInfo
  } catch {
    return null
  }
}

async function fetchGuide(pill: PillInfo): Promise<GuideResponse | null> {
  const params = new URLSearchParams({
    include_professional: 'true',
    include_medguide: 'false',
    include_boxed_warning: 'false',
  })

  try {
    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    const ndc = pill.ndc11 || pill.ndc9
    if (ndc) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(ndc)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
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
}: {
  params: PageParams
}): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  const drugName = resolveDrugName({ guide: null, pill, slug })

  return {
    title: `Professional Information — ${drugName}`,
    description: `Read the FDA professional prescribing information for ${drugName}, including highlights and full prescribing details.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/professional-information` },
  }
}

export default async function ProfessionalInformationPage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guideData = await fetchGuide(pill)
  const drugName = resolveDrugName({ guide: guideData, pill, slug })

  const professionalTocSections = (guideData?.professional_sections ?? [])
    .map(([slugValue, labelValue]) => ({ slug: slugValue, label: labelValue }))
    .filter((section) => section.slug && section.label)
  const hasProfessionalToc = professionalTocSections.length >= MIN_PROFESSIONAL_TOC_SECTIONS
  const hasMedguide = Boolean(guideData?.has_medguide)
  const hasProfessionalContent = Boolean(
    guideData?.professional_html?.trim() || guideData?.professional_highlights_html?.trim()
  )

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
          <li className="text-slate-700 font-medium">Professional Information</li>
        </ol>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Professional Information — {drugName}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Full FDA prescribing details for healthcare professionals.
        </p>
      </div>

      <MedicationGuideTabs
        activeTab="pro"
        medicationGuideHref={
          hasMedguide ? `/pill/${encodeURIComponent(slug)}/medication-guide` : null
        }
        professionalHref={`/pill/${encodeURIComponent(slug)}/professional-information`}
      />

      <div className="space-y-6">
        <MedguideMetaBar guide={guideData} />

        {hasProfessionalToc && (
          <details className="no-print lg:hidden bg-white border border-slate-200 rounded-xl shadow-sm p-4 [&[open]>summary]:mb-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 list-none [&::-webkit-details-marker]:hidden">
              On this page
            </summary>
            <ProfessionalToc sections={professionalTocSections} />
          </details>
        )}

        <div className={hasProfessionalToc ? 'space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[10rem_1fr] lg:gap-8 lg:items-start' : 'space-y-6'}>
          {hasProfessionalToc && (
            <aside className="no-print hidden lg:block lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto w-full lg:w-40">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <ProfessionalToc sections={professionalTocSections} />
              </div>
            </aside>
          )}
          <div className="min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            {guideData?.professional_highlights_html && (
              <div className={`${PRO_HIGHLIGHTS_CONTAINER_CLASSES} mb-6`}>
                <div
                  className={PRO_HIGHLIGHTS_PROSE_CLASSES}
                  dangerouslySetInnerHTML={{ __html: guideData.professional_highlights_html }}
                />
              </div>
            )}

            {guideData?.professional_html ? (
              <article
                id="pro-content"
                className={PRO_PROSE_CLASSES}
                dangerouslySetInnerHTML={{ __html: guideData.professional_html }}
              />
            ) : (
              <ProfessionalEmptyState guide={guideData} />
            )}
          </div>
        </div>
      </div>

      {!hasProfessionalContent && (
        <p className="text-xs text-slate-500">
          Professional information is currently unavailable; this page remains available for navigation and source links.
        </p>
      )}

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
