'use client'

import Link from 'next/link'
import { slugifyDrugName } from '../../../lib/slug'

interface ConditionDrug {
  medicine_name: string
  spl_strength?: string | null
  slug?: string | null
  image_filename?: string | null
  image_url?: string | null
  brand_names?: string | null
  rxcui?: string | null
}

interface ConditionPageClientProps {
  drugs: ConditionDrug[]
  conditionTitle: string
  totalCount?: number
}

const IMAGE_BASE = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || 'https://pillseek.com/images'

function drugImageUrl(imageFilename: string | null | undefined): string | null {
  if (!imageFilename) return null
  const filenames = imageFilename.split(',').map((f) => f.trim()).filter(Boolean)
  if (filenames.length === 0) return null
  return `${IMAGE_BASE}/${filenames[0]}`
}

function DrugCardContent({ drug }: { drug: ConditionDrug }) {
  const imgUrl = drug.image_url ?? drugImageUrl(drug.image_filename)
  return (
    <>
      {imgUrl && (
        <div className="flex justify-center mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl}
            alt={drug.medicine_name}
            className="h-14 w-auto object-contain"
            loading="lazy"
          />
        </div>
      )}
      <div className="font-semibold text-slate-900 text-sm">{drug.medicine_name}</div>
      {drug.spl_strength && (
        <span className="inline-block mt-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
          {drug.spl_strength}
        </span>
      )}
    </>
  )
}

export default function ConditionPageClient({ drugs, conditionTitle, totalCount }: ConditionPageClientProps) {
  if (drugs.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
        <p className="text-slate-600">
          We&apos;re still cataloging medications for this condition. Check back soon.
        </p>
      </div>
    )
  }

  const cardClass =
    'block p-4 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all'

  const displayCount = totalCount ?? drugs.length

  return (
    <div>
      <p className="text-slate-500 text-sm mb-4">
        {displayCount} medication{displayCount !== 1 ? 's' : ''} found for{' '}
        <strong>{conditionTitle}</strong>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {drugs.map((drug) => {
          // Prefer rxcui (always unique per deduplicated row), then slug, then medicine_name.
          const key = drug.rxcui ?? drug.slug ?? drug.medicine_name
          if (drug.slug) {
            return (
              <Link
                key={key}
                href={`/pill/${encodeURIComponent(drug.slug)}`}
                className={cardClass}
              >
                <DrugCardContent drug={drug} />
              </Link>
            )
          }
          // No slug — link by medicine_name (which is the generic name).
          return (
            <Link
              key={key}
              href={`/drug/${slugifyDrugName(drug.medicine_name)}`}
              className={cardClass}
            >
              <DrugCardContent drug={drug} />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
