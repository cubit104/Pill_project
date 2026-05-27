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

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
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
  const generic = genericName?.trim() ? toTitleCase(genericName.trim()) : null
  const brands = normalizeNames(brandName) || null
  const classDisplay = drugClass?.trim() ? toTitleCase(drugClass.trim()) : null
  const formDisplay = dosageForm?.trim() ? toTitleCase(dosageForm.trim()) : null

  const genericIsDuplicate = isBrandPrimary && generic?.toLowerCase() === drugName.toLowerCase()
  const brandsIsDuplicate = !isBrandPrimary && brands?.toLowerCase() === drugName.toLowerCase()
  const hasMetaLines = (!genericIsDuplicate && (isBrandPrimary ? generic : null)) ||
    (!brandsIsDuplicate && (!isBrandPrimary ? brands : null)) ||
    classDisplay ||
    formDisplay

  return (
    <header className="space-y-2">
      {/* Page-type label */}
      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-widest">
        {pageLabel}
      </p>

      {/* H1 — drug name only, no dose */}
      <h1 className="text-4xl font-extrabold text-slate-900 leading-tight">
        {drugName}
      </h1>

      {/* Meta lines: generic/brand, class, dosage form */}
      {hasMetaLines && (
        <div className="border-t border-emerald-100 pt-3 space-y-1.5">
          {/* Line 1: Generic or Brand names */}
          {isBrandPrimary && generic && generic.toLowerCase() !== drugName.toLowerCase() && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Generic:</span>{' '}
              <span className="text-slate-800">{generic}</span>
            </p>
          )}
          {!isBrandPrimary && brands && brands.toLowerCase() !== drugName.toLowerCase() && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Brand names:</span>{' '}
              <span className="text-slate-800">{brands}</span>
            </p>
          )}

          {/* Line 2: Drug class */}
          {classDisplay && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Drug class:</span>{' '}
              <span className="text-slate-800">{classDisplay}</span>
            </p>
          )}

          {/* Line 3: Dosage form */}
          {formDisplay && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Dosage form:</span>{' '}
              <span className="text-slate-800">{formDisplay}</span>
            </p>
          )}
        </div>
      )}
    </header>
  )
}
