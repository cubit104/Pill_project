'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type { PillDetail, RelatedDrug, SimilarPill, ConditionDrug } from '../../../types'
import type { Reviewer } from '../../../lib/reviewers'
import { classSlugify, slugifyDrugName } from '../../../lib/slug'
import { slugifyUrl } from '../../../lib/url-utils'
import DrugIndicationSection from './DrugIndicationSection'
import PriceSummaryCard from './pricing/PriceSummaryCard'
import { usePillView } from './usePillView'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

type PreviewInteractionItem = {
  drug_name: string
  severity: 'major' | 'moderate' | 'minor' | 'unknown' | null
  description: string | null
}

type PreviewInteractionsResponse = {
  total: number
  interactions: PreviewInteractionItem[]
}

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

function truncateText(value: string | null | undefined, maxLength: number): string {
  if (!value) return 'No description available.'
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function PillIconLarge() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="w-24 h-24 text-slate-300"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="12" rx="8" ry="8" />
      <line x1="6" y1="12" x2="18" y2="12" />
    </svg>
  )
}

function DetailRow({ label, value, stripe }: { label: string; value?: string; stripe?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!value) return null
  const shouldTruncate = value.length > 60
  const displayValue = shouldTruncate && !expanded ? `${value.slice(0, 60)}…` : value
  return (
    <div className={`py-2 px-3 flex flex-row items-start gap-2 rounded ${stripe ? 'bg-teal-50' : ''}`}>
      <dt className="text-sm font-semibold text-slate-600 w-36 shrink-0">{label}</dt>
      <dd className="text-sm text-slate-800 flex-1">
        {displayValue}
        {shouldTruncate && (
          <button
            type="button"
            className="text-emerald-600 underline cursor-pointer text-sm ml-1"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse text' : 'Expand full text'}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'See less' : 'See more'}
          </button>
        )}
      </dd>
    </div>
  )
}

function buildImageAlt(pill: PillDetail, index?: number): string {
  const parts = [
    pill.color,
    pill.shape,
    'pill',
    pill.imprint ? `with imprint ${pill.imprint}` : null,
    '—',
    pill.drug_name,
    pill.strength,
  ].filter(Boolean)
  const base = parts.join(' ')
  return index && index > 1 ? `${base} (view ${index})` : base
}

/** Accordion item for the FAQ block. */
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        className="w-full flex justify-between items-center py-3 text-left text-sm font-medium text-slate-800 hover:text-emerald-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{question}</span>
        <span className="ml-4 shrink-0 text-slate-400 select-none" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <p className="pb-3 text-sm text-slate-700 leading-relaxed">{answer}</p>
      )}
    </div>
  )
}

function MedicationResourcesCard({
  resolvedSlug,
  hasMedguide,
  hasMedicationSummary,
}: {
  resolvedSlug: string
  hasMedguide: boolean
  hasMedicationSummary: boolean
}) {
  const encodedSlug = encodeURIComponent(resolvedSlug)
  const ctaHref = hasMedguide
    ? `/pill/${encodedSlug}/medication-guide`
    : hasMedicationSummary
    ? `/pill/${encodedSlug}/medication-summary`
    : `/pill/${encodedSlug}/medication-guide`

  const ctaLabel = hasMedguide
    ? 'Read Medication Guide'
    : hasMedicationSummary
    ? 'Read Medication Summary'
    : 'Read Medication Information'

  const title = hasMedicationSummary && !hasMedguide ? 'Medication Summary' : 'Medication Information'
  const description = hasMedguide
    ? 'Read the official FDA Medication Guide — written for patients, sourced from DailyMed.'
    : hasMedicationSummary
    ? 'No separate FDA Medication Guide was found for this label. Read a patient-friendly summary based on FDA/DailyMed prescribing information.'
    : 'Read prescribing information and professional label data sourced from FDA/DailyMed.'

  return (
    <section className="bg-white border border-emerald-200 rounded-2xl shadow-sm p-6 mb-6">
      <div data-testid="medication-resources-card" className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="flex flex-col justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">{title}</h2>
            <p className="text-slate-600 mb-4">{description}</p>
          </div>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors"
          >
            {ctaLabel}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Link
            href={ctaHref}
            className="border border-slate-100 rounded-lg p-3 flex items-center gap-3 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group"
          >
            <span className="shrink-0 w-8 h-8 rounded-md bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-emerald-600" aria-hidden="true">
                <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16.5a1.5 1.5 0 0 0-1.5-1.5H5z" />
                <path d="M5 4.5V20a1 1 0 0 0 1 1h11.5A1.5 1.5 0 0 0 19 19.5V3" />
                <path d="M8 7h8M8 11h8M8 15h5" />
              </svg>
            </span>
            <span>
              <span className="text-sm font-semibold text-slate-800 block">Medication Guide</span>
              <span className="text-xs text-slate-500">Patient-friendly FDA guide</span>
            </span>
            <span aria-hidden="true" className="ml-auto text-slate-400 group-hover:text-emerald-600 text-sm">→</span>
          </Link>
          <Link
            href={`/pill/${encodedSlug}/dosage`}
            className="border border-slate-100 rounded-lg p-3 flex items-center gap-3 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group"
          >
            <span className="shrink-0 w-8 h-8 rounded-md bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-emerald-600" aria-hidden="true">
                <ellipse cx="12" cy="12" rx="8" ry="8" />
                <line x1="6" y1="12" x2="18" y2="12" />
              </svg>
            </span>
            <span>
              <span className="text-sm font-semibold text-slate-800 block">Dosage &amp; Administration</span>
              <span className="text-xs text-slate-500">Doses, schedules &amp; max doses</span>
            </span>
            <span aria-hidden="true" className="ml-auto text-slate-400 group-hover:text-emerald-600 text-sm">→</span>
          </Link>
          <Link
            href={`/pill/${encodedSlug}/adverse-reactions`}
            className="border border-slate-100 rounded-lg p-3 flex items-center gap-3 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group"
          >
            <span className="shrink-0 w-8 h-8 rounded-md bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-emerald-600" aria-hidden="true">
                <path d="M12 3L2.5 20.5h19L12 3z" />
                <path d="M12 9v5" />
                <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span>
              <span className="text-sm font-semibold text-slate-800 block">Side Effects</span>
              <span className="text-xs text-slate-500">Adverse reactions &amp; safety</span>
            </span>
            <span aria-hidden="true" className="ml-auto text-slate-400 group-hover:text-emerald-600 text-sm">→</span>
          </Link>
          <Link
            href={`/pill/${encodedSlug}/interactions`}
            className="border border-slate-100 rounded-lg p-3 flex items-center gap-3 hover:border-red-300 hover:bg-red-50 transition-colors group"
          >
            <span className="shrink-0 w-8 h-8 rounded-md bg-red-50 flex items-center justify-center group-hover:bg-red-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-red-500" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </span>
            <span>
              <span className="text-sm font-semibold text-slate-800 block">Drug Interactions</span>
              <span className="text-xs text-slate-500">Known drug-drug interactions</span>
            </span>
            <span aria-hidden="true" className="ml-auto text-slate-400 group-hover:text-red-500 text-sm">→</span>
          </Link>
          <Link
            href={`/pill/${encodedSlug}/professional-information`}
            className="border border-slate-100 rounded-lg p-3 flex items-center gap-3 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group"
          >
            <span className="shrink-0 w-8 h-8 rounded-md bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-emerald-600" aria-hidden="true">
                <rect x="6" y="4" width="12" height="16" rx="1.5" />
                <path d="M9 8h6M9 12h6M9 16h4M10 3h4" />
              </svg>
            </span>
            <span>
              <span className="text-sm font-semibold text-slate-800 block">Prescribing Information</span>
              <span className="text-xs text-slate-500">Full FDA prescribing label</span>
            </span>
            <span aria-hidden="true" className="ml-auto text-slate-400 group-hover:text-emerald-600 text-sm">→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

function InteractionsPreviewCard({ slug, drugName }: { slug: string; drugName: string }) {
  const [data, setData] = useState<PreviewInteractionsResponse | null>(null)

  useEffect(() => {
    const trimmedName = drugName.trim()
    if (!trimmedName) return

    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(
          buildApiUrl(`/api/interactions/${encodeURIComponent(trimmedName)}?per_page=3&severity=major`),
          { signal: controller.signal }
        )
        if (!res.ok) return
        const payload = (await res.json()) as PreviewInteractionsResponse
        if (!payload || !payload.total || payload.total <= 0) return
        if (!controller.signal.aborted) setData(payload)
      } catch {
        // Intentionally render nothing on errors.
      }
    }

    void load()
    return () => controller.abort()
  }, [drugName])

  if (!data || data.total <= 0) return null

  return (
    <section className="bg-white border border-red-100 rounded-xl shadow-sm p-6 mb-6">
      <h2 className="text-base font-semibold text-slate-800 mb-1 border-l-4 border-red-400 pl-3">
        ⚠️ Drug Interactions
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        {data.total.toLocaleString()} major interactions known for {drugName}
      </p>
      <div className="space-y-2">
        {(data.interactions || []).slice(0, 3).map((interaction, index) => (
          <div key={`${interaction.drug_name}-${index}`} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${
                interaction.severity === 'major'
                  ? 'bg-red-500'
                  : interaction.severity === 'moderate'
                    ? 'bg-orange-400'
                    : interaction.severity === 'minor'
                      ? 'bg-yellow-400'
                      : 'bg-slate-300'
              }`}
            />
            <p className="text-slate-700 min-w-0">
              <span className="font-semibold text-slate-800">{interaction.drug_name}</span>{' '}
              {truncateText(interaction.description, 80)}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-2">
        <Link
          href={`/pill/${encodeURIComponent(slug)}/interactions`}
          className="text-sm text-red-600 hover:underline font-medium"
        >
          View all major interactions →
        </Link>
      </div>
    </section>
  )
}

export default function PillDetailClient({
  pill,
  slug,
  lastUpdatedIso,
  formattedDate,
  reviewer,
  related,
  pharmaClass,
  similar,
  conditionDrugs,
  conditionTags,
  faqItems,
  identificationSummary,
}: {
  pill: PillDetail
  slug?: string
  lastUpdatedIso?: string
  formattedDate?: string
  reviewer?: Reviewer
  related?: RelatedDrug[]
  pharmaClass?: string
  similar?: SimilarPill[]
  conditionDrugs?: ConditionDrug[]
  conditionTags?: string[]
  faqItems?: Array<{ question: string; answer: string }>
  identificationSummary?: string
}) {
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [showAllBrands, setShowAllBrands] = useState(false)
  const resolvedSlug = slug ?? pill?.slug
  const drugSlug = pill.drug_name !== 'Unknown' ? slugifyDrugName(pill.drug_name) : ''
  const backHref = drugSlug ? `/drug/${drugSlug}` : '/'
  usePillView(resolvedSlug)

  const images = pill.images && pill.images.length > 0
    ? pill.images
    : pill.image_url
    ? [pill.image_url]
    : []
  const [selectedImage, setSelectedImage] = useState<string>(images[0] ?? '')
  const selectedIndex = images.indexOf(selectedImage) === -1 ? 0 : images.indexOf(selectedImage)

  useEffect(() => {
    setSelectedImage((current) => (current && images.includes(current) ? current : (images[0] ?? '')))
  }, [pill.image_url, pill.images])

  const goPrev = () => {
    const prevIndex = (selectedIndex - 1 + images.length) % images.length
    setSelectedImage(images[prevIndex])
  }

  const goNext = () => {
    const nextIndex = (selectedIndex + 1) % images.length
    setSelectedImage(images[nextIndex])
  }

  const deaLabels: Record<string, string> = {
    '1': 'Schedule I – High abuse potential, no accepted medical use',
    '2': 'Schedule II – High abuse potential, severe dependence',
    '3': 'Schedule III – Moderate abuse potential',
    '4': 'Schedule IV – Low abuse potential',
    '5': 'Schedule V – Lowest abuse potential',
  }

  const brandNamesAll = Array.isArray(pill.brand_names_all) ? pill.brand_names_all : []
  const brandNamesKey = brandNamesAll.join('|')
  const brandPreview = brandNamesAll.slice(0, 5).join(', ')
  const brandRemaining = Math.max(0, brandNamesAll.length - 5)

  useEffect(() => {
    setShowAllBrands(false)
  }, [resolvedSlug, brandNamesKey])

  const specsRows: Array<{ label: string; value?: ReactNode }> = [
    { label: 'Imprint', value: pill.imprint },
    { label: 'Strength', value: pill.strength },
    { label: 'Color', value: pill.color },
    { label: 'Dosage Form', value: pill.dosage_form },
    { label: 'Shape', value: pill.shape },
    { label: 'Route', value: pill.route },
    { label: 'Size', value: pill.size ? `${pill.size} mm` : undefined },
    { label: 'RxCUI', value: pill.rxcui },
    { label: 'DEA Schedule', value: pill.dea_schedule ? (deaLabels[pill.dea_schedule] || `Schedule ${pill.dea_schedule}`) : undefined },
  ]
  if (pill.generic_name) {
    specsRows.push({ label: 'Generic Name', value: pill.generic_name })
  }
  if (brandNamesAll.length > 0) {
    specsRows.push({
      label: 'Brand Names',
      value: (
        <>
          {!showAllBrands ? (
            <>
              <span className="brand-preview">{brandPreview}</span>
              {brandRemaining > 0 && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="brand-expand text-emerald-700 hover:underline"
                    onClick={() => setShowAllBrands(true)}
                  >
                    +{brandRemaining} more
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <span className="brand-full">{brandNamesAll.join(', ')}</span>
              {' '}
              <button
                type="button"
                className="brand-expand text-emerald-700 hover:underline"
                onClick={() => setShowAllBrands(false)}
              >
                − show less
              </button>
            </>
          )}
        </>
      ),
    })
  }
  const filteredSpecsRows = specsRows.filter(row => Boolean(row.value))
  const specsStripeClass = (i: number) => {
    const mobileStripe = i % 2 === 0 ? 'bg-teal-50' : ''
    const desktopStripe = Math.floor(i / 2) % 2 === 0 ? 'sm:bg-teal-50' : 'sm:bg-transparent'
    return `py-2 px-3 flex flex-row items-start gap-2 rounded ${mobileStripe} ${desktopStripe}`.trim()
  }

  return (
    <>
      {/* Image Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setZoomImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Zoomed pill image"
        >
          <button
            className="absolute top-4 right-4 text-white text-3xl font-bold leading-none hover:text-slate-300 focus:outline-none"
            onClick={() => setZoomImage(null)}
            aria-label="Close zoom"
          >
            ×
          </button>
          <img
            src={zoomImage}
            alt={buildImageAlt(pill)}
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li>
              <Link href="/" className="hover:text-sky-700 transition-colors">
                Home
              </Link>
            </li>
            {pill.drug_name && pill.drug_name !== 'Unknown' && drugSlug && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link
                    href={`/drug/${drugSlug}`}
                    className="hover:text-sky-700 transition-colors"
                  >
                    {pill.drug_name}
                  </Link>
                </li>
              </>
            )}
            <li aria-hidden="true" className="select-none">›</li>
            <li aria-current="page" className="text-slate-700 font-medium truncate max-w-xs">
              {pill.drug_name}
              {pill.strength ? ` ${pill.strength}` : ''}
              {pill.imprint ? ` (${pill.imprint})` : ''}
            </li>
          </ol>
        </nav>

        {/* Back Button */}
        <Link
          href={backHref}
          className="flex items-center gap-1 text-sky-600 hover:text-sky-800 text-sm font-medium mb-6 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 rounded"
          aria-label="Go back"
        >
          ← Back
        </Link>

        {/* Reviewed by / Last verified — matches JSON-LD dateModified / lastReviewed */}
        {reviewer && (
          <p className="text-xs text-slate-500 mb-3">
            Reviewed by{' '}
            <Link href={reviewer.url} className="underline hover:text-slate-700">
              {reviewer.name}
            </Link>
            {lastUpdatedIso && formattedDate && (
              <>
                {' · '}Last verified{' '}
                <time dateTime={lastUpdatedIso}>{formattedDate}</time>
              </>
            )}
          </p>
        )}

        {/* Hero Card */}
        <div className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
            {/* Image */}
            <div className="w-full">
              {images.length > 0 ? (
                <div className="relative w-full">
                  <button
                    type="button"
                    onClick={() => setZoomImage(selectedImage)}
                    className="block w-full rounded-xl overflow-hidden border border-slate-100 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-sky-500"
                    aria-label="Click to zoom pill image"
                  >
                    <img
                      src={selectedImage}
                      alt={pill.image_alt_text || buildImageAlt(pill)}
                      className="w-full aspect-square object-contain bg-slate-50"
                      width={400}
                      height={400}
                      loading="eager"
                      fetchPriority="high"
                    />
                  </button>
                  {images.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        goPrev()
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-white z-10"
                      aria-label="Previous image"
                    >
                      ‹
                    </button>
                  )}
                  {images.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        goNext()
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-white z-10"
                      aria-label="Next image"
                    >
                      ›
                    </button>
                  )}
                </div>
              ) : (
                <div className="w-full aspect-square bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center">
                  <PillIconLarge />
                </div>
              )}
            </div>

            {/* Header Info */}
            <div className="text-center sm:text-left">
              <h1 className="text-2xl font-bold text-slate-900 mb-1">{pill.drug_name}</h1>
              {pill.strength && (
                <p className="text-slate-500 text-sm mb-3">{pill.strength}</p>
              )}
              {pill.imprint && (
                <div className="mb-3">
                  <Link
                    href={`/imprint/${encodeURIComponent(pill.imprint)}`}
                    className="font-mono text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
                  >
                    Imprint: {pill.imprint}
                  </Link>
                </div>
              )}
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                {pill.color && (
                  <Link
                    href={`/color/${slugifyUrl(pill.color)}`}
                    className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-2.5 py-1 rounded-full font-medium hover:bg-sky-100 transition-colors"
                  >
                    {pill.color}
                  </Link>
                )}
                {pill.shape && (
                  <Link
                    href={`/shape/${slugifyUrl(pill.shape)}`}
                    className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2.5 py-1 rounded-full font-medium hover:bg-teal-100 transition-colors"
                  >
                    {pill.shape}
                  </Link>
                )}
                {pill.dea_schedule && (
                  <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full font-medium">
                    DEA Schedule {pill.dea_schedule}
                  </span>
                )}
              </div>
              {resolvedSlug && (
                <div className="mt-4 hidden sm:block text-left">
                  <PriceSummaryCard
                    slug={resolvedSlug}
                    ndc={pill.ndc}
                    rxcui={pill.rxcui}
                    medicineName={pill.drug_name}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Additional Images */}
          {images.length > 1 && (
            <div className="flex flex-row gap-3 overflow-x-auto pb-1 mt-4 sm:flex-wrap">
              {images.map((img, idx) => (
                <button
                  key={`${img}-${idx}`}
                  type="button"
                  onClick={() => setSelectedImage(img)}
                  className={`shrink-0 rounded-lg overflow-hidden border-2 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    selectedImage === img ? 'border-emerald-400 ring-2 ring-emerald-300' : 'border-slate-100'
                  }`}
                  aria-label={`View pill image ${idx + 1}`}
                >
                  <img
                    src={img}
                    alt={buildImageAlt(pill, idx + 1)}
                    className="w-28 h-28 object-contain bg-slate-50"
                    width={112}
                    height={112}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile-only price card — separate card below hero on small screens */}
        {resolvedSlug && (
          <div className="sm:hidden mb-6">
            <PriceSummaryCard
              slug={resolvedSlug}
              ndc={pill.ndc}
              rxcui={pill.rxcui}
              medicineName={pill.drug_name}
            />
          </div>
        )}

        {/* Share this page */}
        {(() => {
          const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')
          const pageUrl = `${siteUrl}/pill/${slug ?? pill.slug}`
          const shareText = `Identified a pill on PillSeek: ${pill.drug_name}${pill.strength ? ' ' + pill.strength : ''} — check it out!`
          const twitterUrl = `https://x.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(shareText)}`
          const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`
          const pinterestUrl = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&description=${encodeURIComponent(shareText)}${images[0] ? `&media=${encodeURIComponent(images[0])}` : ''}`
          return (
            <section aria-label="Share this page" className="bg-white border border-emerald-200 rounded-xl shadow-sm px-5 py-3 mb-6 flex items-center gap-3">
              <span className="text-xs font-medium text-slate-500 shrink-0">Share:</span>
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 transition-colors"
                aria-label="Share on Twitter"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a
                href={facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                aria-label="Share on Facebook"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a
                href={pinterestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition-colors"
                aria-label="Share on Pinterest"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
              </a>
            </section>
          )
        })()}

        {/* Identification Summary */}
        {identificationSummary && (
          <section className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3">Pill Identification</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{identificationSummary}</p>
          </section>
        )}

        {/* Pill Specifications */}
        <div className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3">Pill Specifications</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {filteredSpecsRows.map((row, index) => (
              <div key={row.label} className={specsStripeClass(index)}>
                <dt className="text-sm font-semibold text-slate-600 w-36 shrink-0">{row.label}</dt>
                <dd className="text-sm text-slate-800 flex-1">{row.value}</dd>
              </div>
            ))}
            {pill.pharma_class && (() => {
              return (
                <div
                  key="Pharmacologic Class"
                  className={`col-span-full ${specsStripeClass(filteredSpecsRows.length)}`}
                >
                  <dt className="text-sm font-semibold text-slate-600 w-36 shrink-0">Pharmacologic Class</dt>
                  <dd className="text-sm text-slate-800 flex-1">
                    <Link
                      href={`/class/${encodeURIComponent(classSlugify(pill.pharma_class))}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {pill.pharma_class}
                    </Link>
                  </dd>
                </div>
              )
            })()}
          </dl>
        </div>

        {/* Ingredients / Composition */}
        {(pill.ingredients || pill.inactive_ingredients) && (
          <div className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3">Composition</h2>
            <dl className="space-y-0.5">
              {[
                { label: 'Active Ingredients', value: pill.ingredients },
                { label: 'Inactive Ingredients', value: pill.inactive_ingredients },
              ].filter(row => Boolean(row.value)).map((row, idx) => (
                <DetailRow key={row.label} label={row.label} value={row.value} stripe={idx % 2 === 0} />
              ))}
            </dl>
          </div>
        )}

        {/* About this medication */}
        <div className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3">About this medication</h2>
          <dl className="space-y-0.5">
            {[
              { label: 'Manufacturer', value: pill.manufacturer },
              { label: 'Status (Rx/OTC)', value: pill.status_rx_otc },
              { label: 'Brand Names', value: pill.brand_names },
              { label: 'NDC Code', value: pill.ndc },
            ].filter(row => Boolean(row.value)).map((row, idx) => (
              <DetailRow key={row.label} label={row.label} value={row.value} stripe={idx % 2 === 0} />
            ))}
          </dl>
          <div className="border-t border-slate-100 mt-3 pt-3">
            <p className="text-sm font-medium text-slate-500 mb-2">Data Sources</p>
            <ul className="space-y-2 text-sm text-slate-700">
              {pill.ndc && (
                <li>
                  <strong>DailyMed</strong>
                  {' — '}
                  <a
                    href={`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(pill.ndc)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 hover:underline"
                  >
                    Search DailyMed for NDC {pill.ndc}
                  </a>
                </li>
              )}
              {pill.rxcui && (
                <li>
                  <strong>RxNorm</strong>
                  {' — '}
                  <a
                    href={`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(pill.rxcui)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 hover:underline"
                  >
                    View in RxNav (RxCUI: {pill.rxcui})
                  </a>
                </li>
              )}
            </ul>
            {lastUpdatedIso && formattedDate && (
              <p className="mt-3 text-xs text-slate-500">
                Data last verified:{' '}
                <time dateTime={lastUpdatedIso}>{formattedDate}</time>
              </p>
            )}
          </div>
        </div>

        {/* Drug Indication */}
        {pill.indication && (
          <DrugIndicationSection
            indication={pill.indication}
            drugName={pill.drug_name}
            imprint={pill.imprint}
            conditionTags={conditionTags}
          />
        )}

        {resolvedSlug && (
          <MedicationResourcesCard
            resolvedSlug={resolvedSlug}
            hasMedguide={pill.has_medguide === true}
            hasMedicationSummary={pill.has_medication_summary === true}
          />
        )}
        {resolvedSlug && <InteractionsPreviewCard slug={resolvedSlug} drugName={pill.drug_name} />}

        {/* FAQ Block */}
        {faqItems && faqItems.length > 0 && (
          <section className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4 border-l-4 border-emerald-500 pl-3">Frequently Asked Questions</h2>
            <div>
              {faqItems.map((item) => (
                <FaqItem key={item.question} question={item.question} answer={item.answer} />
              ))}
            </div>
          </section>
        )}

        {/* Other medications for the same condition */}
        {conditionDrugs && conditionDrugs.length >= 2 && (() => {
          const displayedTags = Array.from(
            new Set(conditionDrugs.flatMap(d => d.shared_tags))
          )
          return (
            <section className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
              <h2 className="text-base font-semibold text-slate-800 mb-1 border-l-4 border-emerald-500 pl-3">
                Other medications used for the same condition
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                These medications are used to treat similar conditions:{' '}
                {displayedTags.map((tag, i) => (
                  <span key={tag}>
                    <span className="font-medium text-emerald-700">{tag}</span>
                    {i < displayedTags.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
              <ul className="grid sm:grid-cols-2 gap-3">
                {conditionDrugs.map((d) => (
                  <li key={d.slug}>
                    <Link
                      href={`/pill/${encodeURIComponent(d.slug)}`}
                      className="flex items-center gap-3 p-3 border border-emerald-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                    >
                      {d.image_url && (
                        <img
                          src={d.image_url}
                          alt={`${d.drug_name}${d.strength ? ` ${d.strength}` : ''}`}
                          className="w-12 h-12 object-contain rounded bg-slate-50 shrink-0"
                          width={48}
                          height={48}
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{d.drug_name}</div>
                        {d.strength && <div className="text-xs text-slate-500">{d.strength}</div>}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {d.shared_tags.map(sharedTag => (
                            <span key={sharedTag} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                              {sharedTag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })()}

        {/* Related Medications — capped at 6, same card layout as condition drugs */}
        {related && related.length > 0 && pharmaClass && (
          <section className="mb-6 bg-white border border-emerald-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1 border-l-4 border-emerald-500 pl-3">Related Medications</h2>
            <p className="text-sm text-slate-500 mb-4">
              Other drugs in the same class:{' '}
              <Link
                href={`/class/${encodeURIComponent(classSlugify(pharmaClass))}`}
                className="text-emerald-700 hover:underline"
              >
                {pharmaClass}
              </Link>
            </p>
            <ul className="grid sm:grid-cols-2 gap-3">
              {related.slice(0, 6).map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/pill/${encodeURIComponent(r.slug)}`}
                    className="flex items-center gap-3 p-3 border border-emerald-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                  >
                    {r.image_url && (
                      <img
                        src={r.image_url}
                        alt={`${r.drug_name}${r.strength ? ` ${r.strength}` : ''}`}
                        className="w-12 h-12 object-contain rounded bg-slate-50 shrink-0"
                        width={48}
                        height={48}
                        loading="lazy"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{r.drug_name}</div>
                      {r.strength && <div className="text-xs text-slate-500">{r.strength}</div>}
                      {(r.color || r.shape) && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {[r.color, r.shape].filter(Boolean).join(' • ')}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Similar-looking Pills (Confusion Risk) */}
        {similar && similar.length > 0 && (
          <section className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1 border-l-4 border-emerald-500 pl-3">
              Similar-looking pills — double-check before taking
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              This pill looks similar to the following. Verify the imprint, color, and shape carefully before taking any medication.
            </p>
            <ul className="grid sm:grid-cols-2 gap-3">
              {similar.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/pill/${encodeURIComponent(p.slug)}`}
                    className="flex items-center gap-3 p-3 border border-emerald-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-colors"
                  >
                    {p.image_url && (
                      <img
                        src={p.image_url}
                        alt={`${p.drug_name}${p.strength ? ` ${p.strength}` : ''} — ${[p.color, p.shape].filter(Boolean).join(' ') || 'pill'}${p.imprint ? ` with imprint ${p.imprint}` : ''}`}
                        className="w-12 h-12 object-contain rounded bg-slate-50 shrink-0"
                        width={48}
                        height={48}
                        loading="lazy"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.drug_name}</div>
                      {p.strength && <div className="text-xs text-slate-500">{p.strength}</div>}
                      {p.imprint && <div className="text-xs text-slate-400 font-mono">Imprint: {p.imprint}</div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Safety Checklist */}
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6" aria-label="Safety checklist">
          <h2 className="text-sm font-semibold text-amber-900 mb-3">⚠️ What to verify before taking this medication</h2>
          <ul className="space-y-2 text-sm text-amber-800 leading-relaxed list-none">
            <li className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>Verify the imprint, color, and shape match exactly — even a single different character can mean a different drug.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>Check the expiration date on the original packaging.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>Look for signs of tampering, discoloration, or unusual odor.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>Confirm with your pharmacist or prescriber before taking any medication you are unsure about.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>Never take medication prescribed to someone else.</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-amber-700">
            This is patient-safety guidance, not medical advice.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
              Read full medical disclaimer
            </Link>
            .
          </p>
        </section>
        <p className="text-center text-xs text-slate-400 mt-2 mb-8">
          For educational use only. Always consult your pharmacist or doctor.{' '}
          <Link href="/medical-disclaimer" className="underline hover:text-slate-600">
            Read disclaimer
          </Link>
          .
        </p>
      </div>
    </>
  )
}
