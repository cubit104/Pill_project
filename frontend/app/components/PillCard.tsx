import Link from 'next/link'
import type { PillResult } from '../types'

interface PillCardProps {
  pill: PillResult
}

// Extend to handle any raw DB field names alongside UI model names as a
// defensive measure against future schema drift or direct API responses.
type PillCardData = PillResult & {
  medicine_name?: string
  splimprint?: string
  spl_strength?: string
}

function getPillIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-12 h-12 text-slate-300"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 12c0 4.142-3.358 7.5-7.5 7.5S4.5 16.142 4.5 12 7.858 4.5 12 4.5s7.5 3.358 7.5 7.5z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.364 8.636L8.636 15.364"
      />
    </svg>
  )
}

function getDrugName(pill: PillResult): string {
  const data = pill as PillCardData
  const candidate = data.drug_name ?? data.medicine_name
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'Unknown Pill'
}

function getImprint(pill: PillResult): string | undefined {
  const data = pill as PillCardData
  const candidate = data.imprint ?? data.splimprint
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function deriveSlug(pill: PillResult): string {
  if (pill.slug) return pill.slug

  // Build slug from drug name + strength (new format, matching the backend)
  const drugName = getDrugName(pill)
  const data = pill as PillCardData
  const strength = pill.strength ?? data.spl_strength

  if (drugName && drugName !== 'Unknown Pill') {
    const parts = [drugName]
    if (strength) parts.push(strength)
    return slugify(parts.join(' '))
  }

  if (pill.ndc) return slugify(pill.ndc)

  return 'unknown-pill'
}

export default function PillCard({ pill }: PillCardProps) {
  const slug = deriveSlug(pill)
  const drugName = getDrugName(pill)
  const imprint = getImprint(pill)

  return (
    <Link
      href={`/pill/${slug}`}
      className="group block bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
      aria-label={`View details for ${drugName}${imprint ? `, imprint ${imprint}` : ''}`}
    >
      <div className="p-5">
        {/* Image / Icon */}
        <div className="flex justify-center mb-4">
          {pill.image_url ? (
            <img
              src={pill.image_url}
              alt={`${drugName} pill`}
              className="w-20 h-20 object-contain rounded-lg border border-slate-100"
            />
          ) : (
            <div className="w-20 h-20 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-center">
              {getPillIcon()}
            </div>
          )}
        </div>

        {/* Drug Name */}
        <h3 className="font-semibold text-slate-900 text-base leading-tight mb-2 line-clamp-2">
          {drugName}
        </h3>

        {/* Strength */}
        {pill.strength && (
          <p className="text-slate-500 text-xs mb-2">{pill.strength}</p>
        )}

        {/* Imprint Badge */}
        {imprint && (
          <div className="mb-3">
            <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded border border-slate-200">
              {imprint}
            </span>
          </div>
        )}

        {/* Color & Shape Chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {pill.color && (
            <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">
              {pill.color}
            </span>
          )}
          {pill.shape && (
            <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
              {pill.shape}
            </span>
          )}
        </div>

        {/* NDC */}
        {pill.ndc && (
          <p className="text-xs text-slate-400 truncate" title={pill.ndc}>
            NDC: {pill.ndc}
          </p>
        )}
      </div>
    </Link>
  )
}
