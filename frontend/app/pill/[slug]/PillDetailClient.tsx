'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PillDetail } from '../../types'

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


function generatePillDescription(pill: PillDetail): string {
  const parts: string[] = []

  // Basic physical description
  const colorShape = [pill.color, pill.shape].filter(Boolean).join(' ')
  const sizeStr = pill.size ? `${pill.size} mm` : ''
  const form = pill.dosage_form || 'Pill'
  // Use "an" before vowel sounds, "a" otherwise
  const firstWord = (colorShape || form)[0]?.toLowerCase() ?? ''
  const article = 'aeiou'.includes(firstWord) ? 'an' : 'a'
  let intro = `This medication is ${article}`
  if (colorShape) intro += ` ${colorShape}`
  if (sizeStr) intro += ` ${sizeStr},`
  intro += ` ${form}`
  if (pill.imprint) {
    intro += ` with imprint "${pill.imprint}".`
  } else {
    intro += '.'
  }
  parts.push(intro)

  // Strength / ingredients
  if (pill.strength && pill.ingredients) {
    parts.push(`It contains ${pill.strength} of ${pill.ingredients}.`)
  } else if (pill.ingredients) {
    parts.push(`It contains ${pill.ingredients}.`)
  }

  // Pharma class
  if (pill.pharma_class) {
    parts.push(`This belongs to the ${pill.pharma_class} pharmacologic class.`)
  }

  // Manufacturer
  if (pill.manufacturer) {
    parts.push(`It is manufactured by ${pill.manufacturer}.`)
  }

  parts.push('For details please contact your physician.')

  return parts.join(' ')
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

export default function PillDetailClient({
  pill,
  slug,
  lastUpdatedIso,
  formattedDate,
}: {
  pill: PillDetail
  slug?: string
  lastUpdatedIso?: string
  formattedDate?: string
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
            {pill.drug_name && pill.drug_name !== 'Unknown' && (
              <>
                <li aria-hidden="true" className="select-none">›</li>
                <li>
                  <Link
                    href={`/drug/${encodeURIComponent(pill.drug_name.toLowerCase())}`}
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
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sky-600 hover:text-sky-800 text-sm font-medium mb-6 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 rounded"
          aria-label="Go back"
        >
          ← Back
        </button>

        {/* Reviewed by / Last updated — matches JSON-LD dateModified / lastReviewed */}
        {(lastUpdatedIso || formattedDate) && (
          <p className="text-xs text-slate-500 mb-3">
            Reviewed by{' '}
            <Link href="/about#editorial-team" className="underline hover:text-slate-700">
              PillSeek Editorial Team
            </Link>
            {formattedDate && lastUpdatedIso && (
              <>
                {' · '}Last updated{' '}
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
                    alt={buildImageAlt(pill)}
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
                    href={`/color/${encodeURIComponent(pill.color.toLowerCase())}`}
                    className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-2.5 py-1 rounded-full font-medium hover:bg-sky-100 transition-colors"
                  >
                    {pill.color}
                  </Link>
                )}
                {pill.shape && (
                  <Link
                    href={`/shape/${encodeURIComponent(pill.shape.toLowerCase())}`}
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

        {/* Description Paragraph */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-3">About This Medication</h2>
          <p className="text-sm text-slate-700 leading-relaxed">{generatePillDescription(pill)}</p>
        </div>

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
              <DetailRow label="Pharmacologic Class" value={pill.pharma_class} />
            </dl>
          </div>
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
            <DetailRow label="Brand Names" value={pill.brand_names} />
            <DetailRow label="NDC Code" value={pill.ndc} />
          </dl>
        </div>

        {/* Related Links */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Browse Related Pills</h2>
          <div className="flex flex-wrap gap-2">
            {pill.drug_name && pill.drug_name !== 'Unknown' && (
              <Link
                href={`/drug/${encodeURIComponent(pill.drug_name.toLowerCase())}`}
                className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
              >
                More {pill.drug_name} pills →
              </Link>
            )}
            {pill.color && (
              <Link
                href={`/color/${encodeURIComponent(pill.color.toLowerCase())}`}
                className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-colors"
              >
                {pill.color} pills →
              </Link>
            )}
            {pill.shape && (
              <Link
                href={`/shape/${encodeURIComponent(pill.shape.toLowerCase())}`}
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
