'use client'

import React, { useState } from 'react'
import PronunciationButton from './PronunciationButton'

type DrugPageHeaderProps = {
  drugName: string
  pronunciation?: string | null
  audioUrl?: string | null
  brandPronunciation?: string | null
  brandAudioUrl?: string | null
  genericPronunciation?: string | null
  genericAudioUrl?: string | null
  genericName?: string | null
  brandName?: string | null
  drugClass?: string | null
  dosageForm?: string | null
  isBrandPrimary: boolean
  pageLabel: string
  slug: string
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

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toLowerCase() : null
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
  pronunciation,
  audioUrl,
  brandPronunciation,
  brandAudioUrl,
  genericPronunciation,
  genericAudioUrl,
  genericName,
  brandName,
  drugClass,
  dosageForm,
  isBrandPrimary,
  pageLabel,
  slug,
}: DrugPageHeaderProps) {
  const headerDrugName = resolveHeaderDrugName({ drugName, genericName, isBrandPrimary })
  const generic = genericName?.trim() ? toTitleCase(genericName.trim()) : null
  const brandList = splitBrandNames(brandName)
  const classDisplay = drugClass?.trim() ? toTitleCase(drugClass.trim()) : null
  const formDisplay = dosageForm?.trim() ? toTitleCase(dosageForm.trim()) : null
  const normalizedHeaderName = normalizeName(headerDrugName)
  const normalizedGenericName = normalizeName(genericName)
  const headerMatchesGeneric =
    !!normalizedHeaderName && !!normalizedGenericName && normalizedHeaderName === normalizedGenericName
  const headerMatchesBrand = !!normalizedHeaderName && brandList.some(
    (brand) => normalizeName(brand) === normalizedHeaderName,
  )
  const resolvedPronunciation = headerMatchesGeneric
    ? (genericPronunciation ?? pronunciation)
    : headerMatchesBrand
      ? (brandPronunciation ?? pronunciation)
      : pronunciation
  const resolvedAudioUrl = headerMatchesGeneric
    ? (genericAudioUrl ?? audioUrl)
    : headerMatchesBrand
      ? (brandAudioUrl ?? audioUrl)
      : audioUrl

  const genericIsDuplicate = generic?.toLowerCase() === headerDrugName.toLowerCase()
  const brandsIsDuplicate =
    brandList.length === 1 && brandList[0].toLowerCase() === headerDrugName.toLowerCase()
  const shouldShowBrands = !isBrandPrimary || genericIsDuplicate

  const showGeneric = isBrandPrimary && !!generic && !genericIsDuplicate
  const showBrands = shouldShowBrands && brandList.length > 0 && !brandsIsDuplicate

  const hasRemainingMeta = showGeneric || showBrands || !!classDisplay || !!formDisplay
  const hasMetaSection = hasRemainingMeta || !!resolvedPronunciation

  return (
    <header className="space-y-2">
      {/* Page-type label */}
      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-widest">
        {pageLabel}
      </p>

      {/* H1 with speaker button inline */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-4xl font-extrabold text-slate-900 leading-tight">
          {headerDrugName}
        </h1>
        <PronunciationButton slug={slug} drugName={headerDrugName} audioUrl={resolvedAudioUrl} pronunciationText={resolvedPronunciation} speakerOnly />
      </div>

      {/* Pronunciation text — directly below drug name, above divider */}
      {resolvedPronunciation && (
        <p className="text-base text-slate-700">
          <span className="font-semibold text-emerald-700 text-base">Pronounced as:</span>{' '}
          <span className="text-slate-800 text-lg italic font-medium">{resolvedPronunciation}</span>
        </p>
      )}

      {/* Divider + remaining meta lines (generic, brand, class, dosage form) */}
      {hasMetaSection && (
        <div className="border-t-2 border-emerald-300 pt-3 space-y-1.5">
          {showGeneric && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Generic:</span>{' '}
              <span className="text-slate-800">{generic}</span>
            </p>
          )}
          {showBrands && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Brand names:</span>{' '}
              <BrandNamesList brands={brandList} />
            </p>
          )}
          {classDisplay && (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-700">Drug class:</span>{' '}
              <span className="text-slate-800">{classDisplay}</span>
            </p>
          )}
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
