type HeaderPillInfo = {
  generic_name?: string | null
  brand_names?: string | null
  brand_names_all?: string[] | null
  pharma_class?: string | null
  dosage_form?: string | null
  is_brand_row?: boolean
  brand_or_generic?: 'brand' | 'generic'
}

type HeaderGuideInfo = {
  generic_name?: string | null
  brand_name?: string | null
  proprietary_name?: string | null
  drug_class?: string | null
  dosage_form?: string | null
}

type HeaderMetadataInput = {
  drugName: string
  pill?: HeaderPillInfo | null
  guide?: HeaderGuideInfo | null
}

type HeaderMetadata = {
  genericName: string | null
  brandName: string | null
  drugClass: string | null
  dosageForm: string | null
  isBrandPrimary: boolean
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function normalizeName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function hasNamePrefix(value: string, prefix: string): boolean {
  if (!value || !prefix) return false
  if (!value.startsWith(prefix)) return false
  const nextChar = value.slice(prefix.length, prefix.length + 1)
  return !nextChar || /[\s,;:/()\-]/.test(nextChar)
}

function splitBrandNames(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[;,/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function dedupeNames(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function resolveBrandNames(pill?: HeaderPillInfo | null, guide?: HeaderGuideInfo | null): string[] {
  const pillAll = Array.isArray(pill?.brand_names_all) ? pill?.brand_names_all : []
  const pillAllNames = pillAll
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean)
  const pillSplitNames = splitBrandNames(pill?.brand_names)
  const guideNames = [guide?.brand_name, guide?.proprietary_name]
    .map((name) => (name ?? '').trim())
    .filter(Boolean)

  return dedupeNames([...pillAllNames, ...pillSplitNames, ...guideNames])
}

export function resolveHeaderMetadata({
  drugName,
  pill,
  guide,
}: HeaderMetadataInput): HeaderMetadata {
  const genericName = firstNonEmpty(guide?.generic_name, pill?.generic_name)
  const brandNames = resolveBrandNames(pill, guide)
  const brandName = brandNames.length > 0 ? brandNames.join(', ') : null

  const normalizedDrugName = normalizeName(drugName)
  const normalizedGeneric = normalizeName(genericName)
  const isDrugNameGeneric = Boolean(
    normalizedDrugName &&
    normalizedGeneric &&
    (normalizedDrugName === normalizedGeneric || hasNamePrefix(normalizedDrugName, normalizedGeneric))
  )
  const isDrugNameBrand = brandNames.some((name) => normalizeName(name) === normalizedDrugName)

  let isBrandPrimary = false
  if (isDrugNameGeneric) isBrandPrimary = false
  else if (isDrugNameBrand) isBrandPrimary = true
  else if (pill?.brand_or_generic === 'brand') isBrandPrimary = true
  else if (pill?.brand_or_generic === 'generic') isBrandPrimary = false
  else if (typeof pill?.is_brand_row === 'boolean') isBrandPrimary = pill.is_brand_row
  else isBrandPrimary = Boolean(firstNonEmpty(guide?.brand_name, guide?.proprietary_name))

  return {
    genericName,
    brandName,
    drugClass: firstNonEmpty(guide?.drug_class, pill?.pharma_class),
    dosageForm: firstNonEmpty(guide?.dosage_form, pill?.dosage_form),
    isBrandPrimary,
  }
}
