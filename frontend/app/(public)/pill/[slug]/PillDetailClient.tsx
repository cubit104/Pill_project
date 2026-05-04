'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PillDetail, RelatedDrug, SimilarPill, ConditionDrug } from '../../../types'
import type { Reviewer } from '../../../lib/reviewers'
import { classSlugify, slugifyDrugName } from '../../../lib/slug'
import { slugifyUrl } from '../../../lib/url-utils'
import DrugIndicationSection from './DrugIndicationSection'

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

        {/* Share this page */}
        {(() => {
          const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')
          const pageUrl = `${siteUrl}/pill/${slug ?? pill.slug}`
          const shareText = `Identified a pill on PillSeek: ${pill.drug_name}${pill.strength ? ' ' + pill.strength : ''} — check it out!`
          const twitterUrl = `https://x.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(shareText)}`
          const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`
          const pinterestUrl = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&description=${encodeURIComponent(shareText)}${images[0] ? `&media=${encodeURIComponent(images[0])}` : ''}`
          return (
            <section aria-label="Share this page" className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-3 mb-6 flex items-center gap-3 flex-wrap">
              <span className="text-xs font-medium text-slate-500">Share:</span>
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors border-slate-200 text-slate-600 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700"
                aria-label="Share on Twitter"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Twitter
              </a>
              <a
                href={facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700"
                aria-label="Share on Facebook"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Facebook
              </a>
              <a
                href={pinterestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors border-slate-200 text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                aria-label="Share on Pinterest"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
                Pinterest
              </a>
            </section>
          )
        })()}

        {/* Identification Summary */}
        {identificationSummary && (
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-3">Pill Identification</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{identificationSummary}</p>
          </section>
        )}

        {/* Drug Indication */}
        {pill.indication && (
          <DrugIndicationSection
            indication={pill.indication}
            drugName={pill.drug_name}
            imprint={pill.imprint}
            conditionTags={conditionTags}
          />
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

        {/* Pill Specs */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Pill Specs</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 [&>div]:border-0 [&>div]:py-1.5">
            <DetailRow label="Imprint" value={pill.imprint} />
            <DetailRow label="Strength" value={pill.strength} />
            <DetailRow label="Color" value={pill.color} />
            <DetailRow label="Dosage Form" value={pill.dosage_form} />
            <DetailRow label="Shape" value={pill.shape} />
            <DetailRow label="Route" value={pill.route} />
            <DetailRow label="Size" value={pill.size ? `${pill.size} mm` : undefined} />
            <DetailRow label="RxCUI" value={pill.rxcui} />
            <DetailRow
              label="DEA Schedule"
              value={
                pill.dea_schedule
                  ? deaLabels[pill.dea_schedule] || `Schedule ${pill.dea_schedule}`
                  : undefined
              }
            />
            {pill.pharma_class && (
              <div className="col-span-full py-1.5 flex flex-col sm:flex-row sm:items-start gap-1">
                <dt className="text-sm font-medium text-slate-500 sm:w-44 shrink-0">Pharmacologic Class</dt>
                <dd className="text-sm text-slate-800 sm:flex-1">
                  <Link
                    href={`/class/${encodeURIComponent(classSlugify(pill.pharma_class))}`}
                    className="text-emerald-700 hover:underline"
                  >
                    {pill.pharma_class}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </div>

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

        {/* Other medications for the same condition */}
        {conditionDrugs && conditionDrugs.length >= 2 && (() => {
          const displayedTags = Array.from(
            new Set(conditionDrugs.flatMap(d => d.shared_tags))
          )
          return (
            <section className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6 mb-6">
              <h2 className="text-base font-semibold text-slate-800 mb-1">
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
                      className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
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
          <section className="mt-0 mb-6 bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1">Related Medications</h2>
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
                    className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
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

        {/* Ingredients */}
        {(pill.ingredients || pill.inactive_ingredients) && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Composition</h2>
            <dl>
              <DetailRow label="Active Ingredients" value={pill.ingredients} />
              <DetailRow label="Inactive Ingredients" value={pill.inactive_ingredients} />
            </dl>
          </div>
        )}

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

        {/* About this medication */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">About this medication</h2>
          <dl>
            <DetailRow label="Manufacturer" value={pill.manufacturer} />
            <DetailRow label="Status (Rx/OTC)" value={pill.status_rx_otc} />
            <DetailRow label="Brand Names" value={pill.brand_names} />
            <DetailRow label="NDC Code" value={pill.ndc} />
          </dl>
          <div className="border-t border-slate-100 mt-3 pt-3">
            <p className="text-sm font-medium text-slate-500 mb-2">Data Sources</p>
            <ul className="space-y-2 text-sm text-slate-700">
              {pill.ndc && (
                <li>
                  <strong>FDA NDC Directory</strong>
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
                  <strong>DailyMed SPL</strong>
                  {' — '}
                  <a
                    href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(pill.spl_set_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 hover:underline"
                  >
                    View SPL document (Set ID: {pill.spl_set_id})
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
