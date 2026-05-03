'use client'

import Link from 'next/link'

interface ConditionDrug {
  medicine_name: string
  spl_strength?: string | null
  slug: string
  image_filename?: string | null
  generic_name?: string | null
  brand_name?: string | null
}

interface ConditionPageClientProps {
  drugs: ConditionDrug[]
  conditionTitle: string
}

const IMAGE_BASE = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || 'https://pillseek.com/images'

function drugImageUrl(imageFilename: string | null | undefined): string | null {
  if (!imageFilename) return null
  const filenames = imageFilename.split(';').map((f) => f.trim()).filter(Boolean)
  if (filenames.length === 0) return null
  return `${IMAGE_BASE}/${filenames[0]}`
}

export default function ConditionPageClient({ drugs, conditionTitle }: ConditionPageClientProps) {
  if (drugs.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
        <p className="text-slate-600">
          We&apos;re still cataloging medications for this condition. Check back soon.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-slate-500 text-sm mb-4">
        {drugs.length} medication{drugs.length !== 1 ? 's' : ''} found for{' '}
        <strong>{conditionTitle}</strong>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {drugs.map((drug) => {
          const imgUrl = drugImageUrl(drug.image_filename)
          return (
            <Link
              key={drug.slug}
              href={`/pill/${encodeURIComponent(drug.slug)}`}
              className="block p-4 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all"
            >
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
              {drug.generic_name && drug.generic_name !== drug.medicine_name && (
                <div className="text-xs text-slate-500 mt-1">{drug.generic_name}</div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
