'use client'

import React, { useState } from 'react'

type DrugPageHeaderProps = {
  drugName: string
  genericName?: string | null
  brandName?: string | null
  drugClass?: string | null
  dosageForm?: string | null
  isBrandPrimary: boolean
  pageLabel: string
}

const BRAND_PREVIEW_COUNT = 5

function splitBrandNames(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[;,/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

function stripTrailingDoseUnits(name: string): string {
  return name.replace(/\s+\d[\d./]*\s*(mg|mcg|ml|g|%|units?|iu|meq)\s*$/i, '').trim()
}

function stripImprintLikeSuffix(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ')
  const tokens = normalized.split(' ')
  if (tokens.length <= 1) return normalized

  for (let i = 1; i < tokens.length; i += 1) {
    if (!/^\d+(?:\.\d+)?$/.test(tokens[i])) continue

    const suffix = tokens.slice(i + 1)
    const hasImprintTail =
      suffix.length > 0 &&
      suffix.every((part) => /^[A-Za-z0-9-]+$/.test(part)) &&
      suffix.some((part) => /\d/.test(part))

    if (hasImprintTail || i === tokens.length - 1) {
      return tokens.slice(0, i).join(' ').trim() || normalized
    }
  }

  return normalized
}

function hasNamePrefix(value: string, prefix: string): boolean {
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return false
  const nextChar = value.slice(prefix.length, prefix.length + 1)
  return !nextChar || /[\s,;:/()-]/.test(nextChar)
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
  const trimmedDrugName = stripImprintLikeSuffix(stripTrailingDoseUnits(drugName.trim()))
  const trimmedGenericName = genericName?.trim()

  if (!isBrandPrimary && trimmedGenericName && hasNamePrefix(trimmedDrugName, trimmedGenericName)) {
    return toTitleCase(trimmedGenericName)
  }

  return trimmedDrugName
}

function BrandNamesList({ brands }: { brands: string[] }) {
  const [showAll, setShowAll] = useState(false)
  const preview = brands.slice(0, BRAND_PREVIEW_COUNT)
  const remaining = brands.length - BRAND_PREVIEW_COUNT

  return (
    <span className="text-slate-800">
      {showAll ? (
        <>
          {brands.join(', ')}{' '}
          <button
            type="button"
            className="text-emerald-700 hover:underline text-xs"
            onClick={() => setShowAll(false)}
          >
            − show less
          </button>
        </>
      ) : (
        <>
          {preview.join(', ')}
          {remaining > 0 && (
            <>
              {' '}
              <button
                type="button"
                className="text-emerald-700 hover:underline text-xs"
                onClick={() => setShowAll(true)}
              >
                +{remaining} more
              </button>
            </>
          )}
        </>
      )}
    </span>
  )
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
  const brandList = splitBrandNames(brandName)
  const classDisplay = drugClass?.trim() ?? null
  const formDisplay = dosageForm?.trim() ? toTitleCase(dosageForm.trim()) : null

  const genericIsDuplicate = generic?.toLowerCase() === headerDrugName.toLowerCase()
  const brandsIsDuplicate =
    brandList.length === 1 && brandList[0].toLowerCase() === headerDrugName.toLowerCase()
  const shouldShowBrands = !isBrandPrimary || genericIsDuplicate

  const showGeneric = isBrandPrimary && !!generic && !genericIsDuplicate
  const showBrands = shouldShowBrands && brandList.length > 0 && !brandsIsDuplicate

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

          {/* Brand names (shown when H1 is a generic name, truncated to 5 + N more) */}
          {showBrands && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Brand names:</span>{' '}
              <BrandNamesList brands={brandList} />
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
