'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PillDetail, RelatedDrug, SimilarPill } from '../../../types'
import type { Reviewer } from '../../../lib/reviewers'
import { classSlugify, slugifyDrugName } from '../../../lib/slug'
import { slugifyUrl } from '../../../lib/url-utils'

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

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="py-3 border-b border-slate-100 last:border-0 flex flex-col sm:flex-row sm:items-start gap-1">
      <dt className="text-sm font-medium text-slate-500 sm:w-44 shrink-0">{label}</dt>
      <dd className="text-sm text-slate-800 sm:flex-1">{value}</dd>
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

function BrandNameChips({ value }: { value?: string }) {
  if (!value) return null
  const names = value.split(',').map((n) => n.trim()).filter(Boolean)
  return (
    <div className="py-3 border-b border-slate-100 last:border-0 flex flex-col sm:flex-row sm:items-start gap-1">
      <dt className="text-sm font-medium text-slate-500 sm:w-44 shrink-0">Brand Names</dt>
      <dd className="text-sm text-slate-800 sm:flex-1">
        {names.map((name, i) => {
          const slug = slugifyDrugName(name)
          return (
            <span key={name}>
              {i > 0 && ', '}
              {slug ? (
                <Link href={`/drug/${slug}`} className="text-sky-700 hover:underline text-sm">
                  {name}
                </Link>
              ) : (
                <span>{name}</span>
              )}
            </span>
          )
        })}
      </dd>
    </div>
  )
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

export default function PillDetailClient({
  pill,
  slug,
  lastUpdatedIso,
  formattedDate,
  reviewer,
  related,
  pharmaClass,
  similar,
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
  faqItems?: Array<{ question: string; answer: string }>
  identificationSummary?: string
}) {
  const router = useRouter()
  const [zoomImage, setZoomImage] = useState<string | null>(null)

  const images = pill.images && pill.images.length > 0
    ? pill.images
    : pill.image_url
    ? [pill.image_url]
    : []

  const deaLabels: Record<string, string> = {
    '1': 'Schedule I – High abuse potential, no accepted medical use',
    '2': 'Schedule II – High abuse potential, severe dependence',
    '3': 'Schedule III – Moderate abuse potential',
    '4': 'Schedule IV – Low abuse potential',
    '5': 'Schedule V – Lowest abuse potential',
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

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
            <li>
              <Link href="/" className="hover:text-sky-700 transition-colors">
                Home
              </Link>
            </li>
            {pill.drug_name && pill.drug_name !== 'Unknown' && (() => {
              const drugSlug = slugifyDrugName(pill.drug_name)
              return drugSlug ? (
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
              ) : null
            })()}
            <li aria-hidden="true" className="select-none">›</li>
            <li aria-current="page" className="text-slate-700 font-medium truncate max-w-xs">
              {pill.drug_name}
              {pill.strength ? ` ${pill.strength}` : ''}
              {pill.imprint ? ` (${pill.imprint})` : ''}
            </li>
          </ol>
        </nav>

        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sky-600 hover:text-sky-800 text-sm font-medium mb-6 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 rounded"
          aria-label="Go back"
        >
          ← Back
        </button>

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
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
            {/* Image */}
            <div className="shrink-0">
              {images.length > 0 ? (
                <button
                  onClick={() => setZoomImage(images[0])}
                  className="block rounded-xl overflow-hidden border border-slate-100 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-sky-500"
                  aria-label="Click to zoom pill image"
                >
                  <img
                    src={images[0]}
                    alt={pill.image_alt_text || buildImageAlt(pill)}
                    className="w-72 h-72 object-contain bg-slate-50"
                    width={288}
                    height={288}
                    loading="eager"
                  />
                </button>
              ) : (
                <div className="w-72 h-72 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center">
                  <PillIconLarge />
                </div>
              )}
            </div>

            {/* Header Info */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-bold text-slate-900 mb-1">
                {(() => {
                  const drugSlug = slugifyDrugName(pill.drug_name)
                  return drugSlug && pill.drug_name !== 'Unknown' ? (
                    <Link href={`/drug/${drugSlug}`} className="hover:underline">
                      {pill.drug_name}
                    </Link>
                  ) : (
                    pill.drug_name
                  )
                })()}
              </h1>
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
            </div>
          </div>

          {/* Additional Images */}
          {images.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {images.slice(1).map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setZoomImage(img)}
                  className="rounded-lg overflow-hidden border border-slate-100 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-sky-500"
                  aria-label={`View alternate pill image ${idx + 2}`}
                >
                  <img
                    src={img}
                    alt={buildImageAlt(pill, idx + 2)}
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

        {/* Identification Summary */}
        {identificationSummary && (
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-3">Pill Identification</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{identificationSummary}</p>
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

        {/* Basic Information */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Basic Information</h2>
          <dl>
            <DetailRow label="Imprint" value={pill.imprint} />
            <DetailRow label="Color" value={pill.color} />
            <DetailRow label="Shape" value={pill.shape} />
            <DetailRow label="Size" value={pill.size ? `${pill.size} mm` : undefined} />
          </dl>
        </div>

        {/* Drug Information */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Drug Information</h2>
          <dl>
            <DetailRow label="Strength" value={pill.strength} />
            <DetailRow label="Dosage Form" value={pill.dosage_form} />
            <DetailRow label="Route" value={pill.route} />
            <DetailRow label="RxCUI" value={pill.rxcui} />
            <DetailRow
              label="DEA Schedule"
              value={
                pill.dea_schedule
                  ? deaLabels[pill.dea_schedule] || `Schedule ${pill.dea_schedule}`
                  : undefined
              }
            />
          </dl>
        </div>

        {/* Pharmaceutical Classification */}
        {pill.pharma_class && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Pharmaceutical Classification</h2>
            <dl>
              <div className="py-3 border-b border-slate-100 last:border-0 flex flex-col sm:flex-row sm:items-start gap-1">
                <dt className="text-sm font-medium text-slate-500 sm:w-44 shrink-0">Pharmacologic Class</dt>
                <dd className="text-sm text-slate-800 sm:flex-1">
                  <Link
                    href={`/class/${encodeURIComponent(classSlugify(pill.pharma_class))}`}
                    className="text-emerald-700 hover:underline"
                  >
                    {pill.pharma_class}
                  </Link>
                  <a
                    href={`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(pill.pharma_class)}&searchfields=pharmacologic_class`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-400 hover:underline ml-2"
                  >
                    Search this class on DailyMed ↗
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Similar-looking Pills (Confusion Risk) */}
        {similar && similar.length > 0 && (
          <section className="bg-white border border-amber-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1">
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
                    className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-colors"
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

        {/* Related Medications */}
        {related && related.length > 0 && pharmaClass && (
          <section className="mt-0 mb-6 bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Related Medications</h2>
            <p className="text-sm text-slate-500 mb-4">
              Other drugs in the same class:{' '}
              <Link
                href={`/class/${encodeURIComponent(classSlugify(pharmaClass))}`}
                className="text-emerald-700 hover:underline"
              >
                {pharmaClass}
              </Link>
            </p>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/pill/${encodeURIComponent(r.slug)}`}
                    className="block p-3 border border-slate-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <div className="font-medium text-slate-900">{r.drug_name}</div>
                    {r.strength && <div className="text-xs text-slate-500">{r.strength}</div>}
                    {(r.color || r.shape) && (
                      <div className="text-xs text-slate-400 mt-0.5">{[r.color, r.shape].filter(Boolean).join(' • ')}</div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Ingredients */}
        {(pill.ingredients || pill.inactive_ingredients) && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Ingredients</h2>
            <dl>
              <DetailRow label="Active Ingredients" value={pill.ingredients} />
              <DetailRow label="Inactive Ingredients" value={pill.inactive_ingredients} />
            </dl>
          </div>
        )}

        {/* Additional Information */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Additional Information</h2>
          <dl>
            <DetailRow label="Manufacturer" value={pill.manufacturer} />
            <DetailRow label="Status (Rx/OTC)" value={pill.status_rx_otc} />
            <BrandNameChips value={pill.brand_names} />
            <DetailRow label="NDC Code" value={pill.ndc} />
          </dl>
        </div>

        {/* FAQ Block */}
        {faqItems && faqItems.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Frequently Asked Questions</h2>
            <div>
              {faqItems.map((item) => (
                <FaqItem key={item.question} question={item.question} answer={item.answer} />
              ))}
            </div>
          </section>
        )}

        {/* Source Citations */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-3">Data Sources</h2>
          <ul className="space-y-2 text-sm text-slate-700">
            {pill.ndc && (
              <li>
                <strong>DailyMed NDC Search</strong>
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
            {pill.spl_set_id && (
              <li>
                <strong>FDA Drug Label (DailyMed)</strong>
                {' — '}
                <a
                  href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(pill.spl_set_id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-700 hover:underline"
                >
                  View official drug label ↗
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
        </section>

        {/* Related Links */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Browse Related Pills</h2>
          <div className="flex flex-wrap gap-2">
            {pill.drug_name && pill.drug_name !== 'Unknown' && (() => {
              const drugSlug = slugifyDrugName(pill.drug_name)
              return drugSlug ? (
                <Link
                  href={`/drug/${drugSlug}`}
                  className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
                >
                  More {pill.drug_name} pills →
                </Link>
              ) : null
            })()}
            {pill.color && (
              <Link
                href={`/color/${slugifyUrl(pill.color)}`}
                className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
              >
                {pill.color} pills →
              </Link>
            )}
            {pill.shape && (
              <Link
                href={`/shape/${slugifyUrl(pill.shape)}`}
                className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
              >
                {pill.shape} pills →
              </Link>
            )}
            {pill.imprint && (
              <Link
                href={`/imprint/${encodeURIComponent(pill.imprint)}`}
                className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
              >
                Imprint {pill.imprint} →
              </Link>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-amber-800 text-sm leading-relaxed">
            <strong>⚠️ Important:</strong> This information is for educational purposes only.
            Do not use this tool for medical diagnosis or treatment decisions. Always consult
            your pharmacist or healthcare provider for questions about your medications.{' '}
            <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
              Read full medical disclaimer
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  )
}

