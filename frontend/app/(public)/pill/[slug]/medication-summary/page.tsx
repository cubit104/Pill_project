import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import MedicationGuideTabs from '../medication-guide/MedicationGuideTabs'
import { slugifyDrugName } from '../../../../lib/slug'
import { breadcrumbSchema, faqSchema, guidePageSchema, safeJsonLd } from '../../../../lib/structured-data'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const GUIDE_REVALIDATE_SECONDS = 86400

const SAFETY_NOTICE =
  'This patient-friendly summary is based on FDA/DailyMed prescribing information. It is not a substitute for medical advice. Not every medication has a separate FDA Medication Guide.'
const BOXED_WARNING_NOTICE =
  'This label includes a boxed warning. Review the full prescribing information and talk to a healthcare professional.'
const SUMMARY_NOTICE_FALLBACK = 'Patient-friendly summary based on FDA/DailyMed prescribing information.'

type PageParams = Promise<{ slug: string }>

type PillInfo = {
  spl_set_id?: string
  rxcui?: string
  ndc11?: string
  ndc9?: string
  medicine_name?: string
  brand_names?: string
}

type SummaryQA = { question: string; answer: string }

type GuideResponse = {
  rxcui?: string
  ndc?: string
  generic_name?: string
  brand_name?: string
  proprietary_name?: string
  display_name?: string
  name?: string
  has_medguide?: boolean
  has_boxed_warning?: boolean
  has_medication_summary?: boolean
  medication_summary_json?: { questions?: SummaryQA[]; notice?: string } | null
  medication_summary_html?: string | null
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
    include_professional: 'false',
    include_medguide: 'false',
    include_boxed_warning: 'true',
  })

  try {
    if (pill.spl_set_id) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-setid/${encodeURIComponent(pill.spl_set_id)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc11)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.rxcui) {
      const res = await fetch(
        `${API_BASE}/api/drugs/${encodeURIComponent(pill.rxcui)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    if (pill.ndc9 && pill.ndc9 !== pill.ndc11) {
      const res = await fetch(
        `${API_BASE}/api/drugs/by-ndc/${encodeURIComponent(pill.ndc9)}/guide?${params.toString()}`,
        { next: { revalidate: GUIDE_REVALIDATE_SECONDS } }
      )
      if (res.ok) return (await res.json()) as GuideResponse
    }

    return null
  } catch {
    return null
  }
}

function summaryQuestions(guide: GuideResponse | null): SummaryQA[] {
  const questions = guide?.medication_summary_json?.questions
  if (!Array.isArray(questions)) return []
  return questions.filter(
    (item): item is SummaryQA => item?.question != null && item?.answer != null
  )
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  const guide = pill ? await fetchGuide(pill) : null
  const drugName = resolveDrugName({ guide, pill, slug })

  const hasOfficialMedguide = Boolean(guide?.has_medguide)
  const hasSummary = Boolean(guide?.has_medication_summary || guide?.medication_summary_html?.trim())

  if (hasOfficialMedguide) {
    return {
      title: `${drugName} Medication Guide, Warnings & FDA Label`,
      description: `Read the FDA Medication Guide for ${drugName}.`,
      alternates: { canonical: `/pill/${encodeURIComponent(slug)}/medication-guide` },
      robots: { index: false, follow: true },
    }
  }

  if (!hasSummary) {
    return {
      title: `${drugName} Medication Summary`,
      robots: { index: false, follow: true },
    }
  }

  return {
    title: `${drugName} Medication Summary — FDA Label Overview`,
    description: `Patient-friendly FDA/DailyMed label summary for ${drugName}, including warnings, usage, side effects, and interactions.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/medication-summary` },
    robots: { index: true, follow: true },
  }
}

export default async function MedicationSummaryPage({ params }: { params: PageParams }) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const guideData = await fetchGuide(pill)
  const hasOfficialMedguide = Boolean(guideData?.has_medguide)
  if (hasOfficialMedguide) {
    redirect(`/pill/${encodeURIComponent(slug)}/medication-guide`)
  }

  const questions = summaryQuestions(guideData)
  if (questions.length === 0) notFound()

  const drugName = resolveDrugName({ guide: guideData, pill, slug })
  const encodedSlug = encodeURIComponent(slug)
  const drugSlug = slugifyDrugName(drugName)

  const pageJsonLd = guidePageSchema({
    drugName,
    slug,
    pageType: 'medication-summary',
    rxcui: guideData?.rxcui ?? pill.rxcui,
    ndc: guideData?.ndc ?? pill.ndc11 ?? pill.ndc9,
    splSetId: pill.spl_set_id,
    genericName: guideData?.generic_name,
    brandName: guideData?.brand_name ?? guideData?.proprietary_name,
    fetchedAt: guideData?.fetched_at,
  })

  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Medication Summary', url: `/pill/${encodedSlug}/medication-summary` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(pageJsonLd) }} />
      {questions.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema(questions)) }} />
      )}

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li>
              <Link href="/" className="hover:text-sky-700 transition-colors">Home</Link>
            </li>
            {drugSlug && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link href={`/drug/${drugSlug}`} className="hover:text-sky-700 transition-colors">{drugName}</Link>
                </li>
              </>
            )}
            <li aria-hidden="true" className="select-none">›</li>
            <li className="text-slate-700 font-medium">Medication Summary</li>
          </ol>
        </nav>

        <div>
          <h1 className="text-2xl font-bold text-slate-900">{drugName} Medication Summary</h1>
          <p className="mt-2 text-sm text-slate-600">
            {guideData?.medication_summary_json?.notice ?? SUMMARY_NOTICE_FALLBACK}
          </p>
        </div>

        <MedicationGuideTabs
          activeTab="consumer"
          medicationGuideHref={null}
          summaryHref={`/pill/${encodedSlug}/medication-summary`}
          professionalHref={`/pill/${encodedSlug}/professional-information`}
        />

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {SAFETY_NOTICE}
        </section>

        {guideData?.has_boxed_warning && (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-900">
            {BOXED_WARNING_NOTICE}
          </section>
        )}

        <div className="space-y-4">
          {questions.map((item) => (
            <section key={item.question} className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-2">{item.question}</h2>
              <p className="text-sm leading-7 text-slate-700">{item.answer}</p>
            </section>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 space-y-2">
          <p>
            <Link href={`/pill/${encodedSlug}/professional-information`} className="text-emerald-700 hover:underline">
              View full Professional Information
            </Link>
          </p>
          <p>
            <Link href={`/pill/${encodedSlug}`} className="text-emerald-700 hover:underline">
              Return to main pill page
            </Link>
          </p>
          {guideData?.source_url && (
            <p>
              Source:{' '}
              <a href={guideData.source_url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">
                DailyMed prescribing information ↗
              </a>
            </p>
          )}
        </section>

        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
          <p className="text-xs text-amber-700 leading-relaxed">
            This summary is for educational purposes only and is not medical advice. Always consult your doctor,
            pharmacist, or other licensed healthcare professional before starting, stopping, or changing any medicine.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">Read full medical disclaimer</Link>.
          </p>
        </section>
      </div>
    </>
  )
}
