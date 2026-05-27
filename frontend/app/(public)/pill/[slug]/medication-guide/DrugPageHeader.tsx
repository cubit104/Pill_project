import React from 'react'

type DrugPageHeaderProps = {
  drugName: string
  genericName?: string | null
  brandName?: string | null
  drugClass?: string | null
  dosageForm?: string | null
  isBrandPrimary: boolean
  pageLabel: string
}

function normalizeNames(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .split(/[;,/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

export default function DrugPageHeader({
  drugName,
  genericName,
  brandName,
  drugClass,
  dosageForm,
  isBrandPrimary,
  pageLabel,
}: DrugPageHeaderProps) {
  const generic = genericName?.trim() || null
  const brands = normalizeNames(brandName) || null

  return (
    <header className="space-y-3">
      <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide mb-1">{pageLabel}</p>
      <h1 className="text-2xl font-bold text-slate-900">{drugName}</h1>

      {isBrandPrimary && generic && (
        <p className="border-t border-emerald-100 pt-2 text-sm text-slate-600">
          <span className="font-medium text-emerald-700">Generic:</span> {generic}
        </p>
      )}
      {!isBrandPrimary && brands && (
        <p className="border-t border-emerald-100 pt-2 text-sm text-slate-600">
          <span className="font-medium text-emerald-700">Brand names:</span> {brands}
        </p>
      )}

      {(drugClass || dosageForm) && (
        <div className="flex flex-wrap items-center gap-2">
          {drugClass && (
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-3 py-0.5 text-xs font-medium">
              🧬 {drugClass}
            </span>
          )}
          {dosageForm && (
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-3 py-0.5 text-xs font-medium">
              💊 {dosageForm}
            </span>
          )}
        </div>
      )}
    </header>
  )
}
