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
  // API values may be delimited by commas, semicolons, or slashes (e.g. "Plavix; Iscover / Clopilet").
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

  return (
    <header className="space-y-3">
      <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">{pageLabel}</p>
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

      {(classDisplay || formDisplay) && (
        <div className="flex flex-wrap items-center gap-2">
          {classDisplay && (
            <span
              className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-3 py-0.5 text-xs font-medium"
              aria-label={`Drug class: ${classDisplay}`}
            >
              <span aria-hidden="true">🧬</span>
              {classDisplay}
            </span>
          )}
          {formDisplay && (
            <span
              className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-3 py-0.5 text-xs font-medium"
              aria-label={`Dosage form: ${formDisplay}`}
            >
              <span aria-hidden="true">💊</span>
              {formDisplay}
            </span>
          )}
        </div>
      )}
    </header>
  )
}
