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

function stripTrailingDose(name: string): string {
  return name.replace(/\s+\d[\d./]*\s*(mg|mcg|ml|g|%|units?|iu|meq)\s*$/i, '').trim()
}

function hasNamePrefix(value: string, prefix: string): boolean {
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return false
  const nextChar = value.slice(prefix.length, prefix.length + 1)
  return !nextChar || /[\s,;:/()\-]/.test(nextChar)
}

function resolveHeaderDrugName({
  drugName,
  genericName,
  isBrandPrimary,
}: {
  drugName: string
  genericName?: string | null
  isBrandPrimary: boolean
}): string {
  const trimmedDrugName = stripTrailingDose(drugName.trim())
  const trimmedGenericName = genericName?.trim()

  if (!isBrandPrimary && trimmedGenericName && hasNamePrefix(trimmedDrugName, trimmedGenericName)) {
    return toTitleCase(trimmedGenericName)
  }

  return trimmedDrugName
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
  const headerDrugName = resolveHeaderDrugName({ drugName, genericName, isBrandPrimary })
  const generic = genericName?.trim() ? toTitleCase(genericName.trim()) : null
  const brands = normalizeNames(brandName) || null
  const classDisplay = drugClass?.trim() ? toTitleCase(drugClass.trim()) : null
  const formDisplay = dosageForm?.trim() ? toTitleCase(dosageForm.trim()) : null

  const genericIsDuplicate = generic?.toLowerCase() === headerDrugName.toLowerCase()
  const brandsIsDuplicate = brands?.toLowerCase() === headerDrugName.toLowerCase()

  // H1 is a brand name → show Generic: line (if not same as H1)
  const showGeneric = isBrandPrimary && !!generic && !genericIsDuplicate
  // H1 is a generic name (or generic == H1) → show Brand names: line (if not same as H1)
  const showBrands = (!isBrandPrimary || genericIsDuplicate) && !!brands && !brandsIsDuplicate

  const hasMetaLines = showGeneric || showBrands || !!classDisplay || !!formDisplay

  return (
    <header className="space-y-2">
      {/* Page-type label */}
      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-widest">
        {pageLabel}
      </p>

      {/* H1 — drug name, no dose */}
      <h1 className="text-4xl font-extrabold text-slate-900 leading-tight">
        {headerDrugName}
      </h1>

      {/* Meta lines: generic/brand, class, dosage form */}
      {hasMetaLines && (
        <div className="border-t border-emerald-100 pt-3 space-y-1.5">
          {/* Generic (shown when H1 is a brand name, e.g. Plavix → Generic: Clopidogrel) */}
          {showGeneric && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Generic:</span>{' '}
              <span className="text-slate-800">{generic}</span>
            </p>
          )}

          {/* Brand names (shown when H1 is a generic name, e.g. Losartan Potassium → Brand names: Cozaar) */}
          {showBrands && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Brand names:</span>{' '}
              <span className="text-slate-800">{brands}</span>
            </p>
          )}

          {/* Drug class */}
          {classDisplay && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Drug class:</span>{' '}
              <span className="text-slate-800">{classDisplay}</span>
            </p>
          )}

          {/* Dosage form */}
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
