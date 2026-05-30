import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DrugPageHeader from '../medication-guide/DrugPageHeader'
import MedguideMetaBar from '../medication-guide/MedguideMetaBar'
import {
  SHARED_CONTENT_CARD_CLASSES,
  SHARED_READING_PROSE_CLASSES,
} from '../medication-guide/layoutStyles'
import { resolveHeaderMetadata } from '../medication-guide/headerMetadata'
import { breadcrumbSchema, safeJsonLd } from '../../../../lib/structured-data'
import { slugifyDrugName } from '../../../../lib/slug'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000'
const PILL_REVALIDATE_SECONDS = 3600
const DOSAGE_REVALIDATE_SECONDS = 86400
const BOXED_WARNING_CARD_CLASSES =
  'rounded-xl border border-rose-300 border-l-4 border-l-rose-600 bg-rose-50 p-5 text-rose-950 [&[open]>summary]:mb-3'
const BOXED_WARNING_PROSE_CLASSES =
  'text-sm [&_.boxed-warning-content]:space-y-0 [&_.boxed-warning-content_h2]:mt-5 [&_.boxed-warning-content_h2]:mb-3 [&_.boxed-warning-content_h2]:text-base [&_.boxed-warning-content_h2]:font-semibold [&_.boxed-warning-content_h2]:text-rose-900 [&_.boxed-warning-content_h3]:mt-4 [&_.boxed-warning-content_h3]:mb-2 [&_.boxed-warning-content_h3]:text-sm [&_.boxed-warning-content_h3]:font-semibold [&_.boxed-warning-content_h3]:text-rose-900 [&_.boxed-warning-content_p]:my-3 [&_.boxed-warning-content_p]:leading-8 [&_.boxed-warning-content_p]:text-rose-950 [&_.boxed-warning-content_ul]:my-3 [&_.boxed-warning-content_ul]:list-disc [&_.boxed-warning-content_ul]:pl-5 [&_.boxed-warning-content_ul]:space-y-2 [&_.boxed-warning-content_ol]:my-3 [&_.boxed-warning-content_ol]:list-decimal [&_.boxed-warning-content_ol]:pl-5 [&_.boxed-warning-content_ol]:space-y-2 [&_.boxed-warning-content_li]:my-2 [&_.boxed-warning-content_li]:leading-8 [&_.boxed-warning-content_li]:text-rose-950 [&_.boxed-warning-content_a]:text-rose-800 [&_.boxed-warning-content_a:hover]:text-rose-950 [&_.boxed-warning-content_strong]:font-semibold [&_.boxed-warning-content_strong]:text-rose-950'

type PageParams = Promise<{ slug: string }>

type PillInfo = {
  drug_name?: string | null
  generic_name?: string | null
  brand_names?: string | null
  brand_names_all?: string[] | null
  pharma_class?: string | null
  dosage_form?: string | null
  is_brand_row?: boolean
  brand_or_generic?: 'brand' | 'generic'
}

type DosageResponse = {
  drug_name?: string | null
  generic_name?: string | null
  brand_name?: string | null
  rxcui?: string | null
  ndc?: string | null
  spl_set_id?: string | null
  dosage?: string | null
  has_boxed_warning?: boolean
  boxed_warning_html?: string | null
  drug_class?: string | null
  dosage_form?: string | null
  source_url?: string | null
  fetched_at?: string | null
}

function stripDoseFromName(name: string): string {
  return name.replace(/\s+\d[\d./]*\s*(mg|mcg|ml|g|%|units?|iu|meq)\s*$/i, '').trim()
}

function resolveDrugName(pill: PillInfo | null, slug: string): string {
  const name = pill?.drug_name?.trim()
  return name || decodeURIComponent(slug).replace(/-/g, ' ')
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

async function fetchDosage(slug: string): Promise<DosageResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/pill/${encodeURIComponent(slug)}/dosage`, {
      next: { revalidate: DOSAGE_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null
    return (await res.json()) as DosageResponse
  } catch {
    return null
  }
}

function tabClasses(active: boolean): string {
  return `px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
    active
      ? 'text-emerald-700 border-emerald-700'
      : 'text-slate-500 border-transparent hover:text-slate-700'
  }`
}

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { slug } = await params
  const pill = await fetchPill(slug)
  const drugName = resolveDrugName(pill, slug)

  return {
    title: `${drugName} Dosage Guide – Recommended Doses & Instructions | PillSeek`,
    description: `View recommended dosage for ${drugName}, including adult doses, pediatric doses, and dosing adjustments. FDA-approved prescribing information.`,
    alternates: { canonical: `/pill/${encodeURIComponent(slug)}/dosage` },
  }
}

export default async function DosagePage({
  params,
}: {
  params: PageParams
}) {
  const { slug } = await params
  const pill = await fetchPill(slug)
  if (!pill) notFound()

  const dosageData = await fetchDosage(slug)
  const dosageHtml = dosageData?.dosage?.trim() ? dosageData.dosage : null
  const drugName = resolveDrugName(pill, slug)
  const headerDrugName = stripDoseFromName(drugName)
  const headerMeta = resolveHeaderMetadata({
    drugName: headerDrugName,
    pill,
    guide: {
      generic_name: dosageData?.generic_name ?? null,
      brand_name: null,
      proprietary_name: null,
      drug_class: dosageData?.drug_class ?? null,
      dosage_form: dosageData?.dosage_form ?? null,
    },
  })

  const drugSlug = slugifyDrugName(drugName)
  const encodedSlug = encodeURIComponent(slug)
  const dosageBreadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(drugSlug ? [{ name: drugName, url: `/drug/${drugSlug}` }] : []),
    { name: 'Dosage', url: `/pill/${encodedSlug}/dosage` },
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(dosageBreadcrumbs) }} />
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
            <li className="text-slate-700 font-medium">Dosage</li>
          </ol>
        </nav>

        <DrugPageHeader
          pageLabel="Dosage Guide"
          drugName={headerDrugName}
          genericName={headerMeta.genericName}
          brandName={headerMeta.brandName}
          drugClass={headerMeta.drugClass}
          dosageForm={headerMeta.dosageForm}
          isBrandPrimary={headerMeta.isBrandPrimary}
        />

        <div className="no-print bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-6">
          <nav role="navigation" className="flex gap-4 sm:gap-6 border-b border-slate-200" aria-label="Medication content tabs">
            <Link href={`/pill/${encodedSlug}/medication-guide`} className={tabClasses(false)}>
              Medication Guide
            </Link>
            <span className={tabClasses(true)} aria-current="page">
              Dosage
            </span>
            <Link href={`/pill/${encodedSlug}/professional-information`} className={tabClasses(false)}>
              Professional Information
            </Link>
          </nav>
        </div>

        <div className="space-y-6">
          <MedguideMetaBar guide={dosageData} />

          {dosageData?.has_boxed_warning && (
            <details open className={BOXED_WARNING_CARD_CLASSES}>
              <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-rose-900 [&::-webkit-details-marker]:hidden">
                <span aria-hidden>⚠️</span>
                <span>Boxed Warning</span>
              </summary>
              {dosageData?.boxed_warning_html ? (
                <div className={BOXED_WARNING_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: dosageData.boxed_warning_html }} />
              ) : (
                <p className="text-sm leading-8 text-rose-950">
                  This medication includes an FDA boxed warning. See the Full Prescribing Information for details.
                </p>
              )}
            </details>
          )}

          <div className={`${SHARED_CONTENT_CARD_CLASSES} lg:max-w-[60rem] lg:mx-auto`}>
            {dosageHtml ? (
              <article className={SHARED_READING_PROSE_CLASSES} dangerouslySetInnerHTML={{ __html: dosageHtml }} />
            ) : (
              <div className="text-center text-sm text-slate-600 py-8">
                Dosage information is not available for this medication.
              </div>
            )}
          </div>
        </div>

        {(dosageData?.rxcui || dosageData?.ndc || dosageData?.fetched_at || dosageData?.source_url) && (
          <section className="border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
            <h2 className="font-semibold text-slate-600 mb-2">Sources</h2>
            {dosageData?.rxcui && <p><span className="font-medium">RxCUI:</span> {dosageData.rxcui}</p>}
            {dosageData?.ndc && <p><span className="font-medium">NDC:</span> {dosageData.ndc}</p>}
            {dosageData?.fetched_at && (
              <p><span className="font-medium">Last fetched:</span>{' '}
                {new Date(dosageData.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </p>
            )}
            {dosageData?.source_url && (
              <p>
                <span className="font-medium">Source:</span>{' '}
                <a href={dosageData.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
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
