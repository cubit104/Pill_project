/**
 * Authoritative field schema for pillfinder editable columns.
 * Mirrors routes/admin/field_schema.py — keep in sync.
 */

export type FieldTier = 'required' | 'required_or_na' | 'optional'

export interface FieldSchemaEntry {
  key: string
  label: string
  tier: FieldTier
  /** If set, the field is only required when data[conditional] === 'TRUE' */
  conditional?: string
  inputType?: 'text' | 'textarea'
  placeholder?: string
}

export const FIELD_SCHEMA: FieldSchemaEntry[] = [
  // Tier 1 — Required
  { key: 'medicine_name',     label: 'Drug Name',            tier: 'required' },
  { key: 'author',            label: 'Manufacturer',         tier: 'required' },
  { key: 'spl_strength',      label: 'Strength',             tier: 'required' },
  { key: 'splimprint',        label: 'Imprint',              tier: 'required' },
  { key: 'splcolor_text',     label: 'Color',                tier: 'required' },
  { key: 'splshape_text',     label: 'Shape',                tier: 'required' },
  { key: 'slug',              label: 'Slug',                 tier: 'required' },

  // Tier 2 — Required or N/A
  { key: 'ndc9',              label: 'NDC-9',                tier: 'required_or_na' },
  { key: 'ndc11',             label: 'NDC-11',               tier: 'required_or_na' },
  { key: 'dosage_form',       label: 'Dosage Form',          tier: 'required_or_na' },
  { key: 'route',             label: 'Route',                tier: 'required_or_na' },
  { key: 'spl_ingredients',   label: 'Active Ingredients',   tier: 'required_or_na', inputType: 'textarea' },
  { key: 'spl_inactive_ing',  label: 'Inactive Ingredients', tier: 'required_or_na', inputType: 'textarea' },
  { key: 'dea_schedule_name', label: 'DEA Schedule',         tier: 'required_or_na' },
  { key: 'status_rx_otc',     label: 'Rx/OTC Status',        tier: 'required_or_na' },
  { key: 'image_alt_text',    label: 'Image Alt Text',       tier: 'required_or_na', conditional: 'has_image',
    placeholder: 'White oval pill imprinted MP 45' },

  // Tier 3 — Optional
  { key: 'brand_names',       label: 'Brand Names',          tier: 'optional' },
  { key: 'splsize',           label: 'Size',                 tier: 'optional' },
  { key: 'meta_title',        label: 'SEO Title',            tier: 'optional', inputType: 'text',
    placeholder: 'Auto-generated — edit to override' },
  { key: 'meta_description',  label: 'Meta Description',     tier: 'optional', inputType: 'textarea' },
  { key: 'pharmclass_fda_epc',label: 'FDA Pharma Class',     tier: 'optional' },
  { key: 'rxcui',             label: 'RxCUI',                tier: 'optional' },
  { key: 'rxcui_1',           label: 'RxCUI Alt',            tier: 'optional' },
  { key: 'imprint_status',    label: 'Imprint Status',       tier: 'optional' },
  { key: 'tags',              label: 'Tags (comma-separated)', tier: 'optional',
    placeholder: 'blood pressure, hypertension, generic' },
]

export const FIELD_SCHEMA_BY_KEY: Record<string, FieldSchemaEntry> =
  Object.fromEntries(FIELD_SCHEMA.map(f => [f.key, f]))

export const TIER1_KEYS = FIELD_SCHEMA.filter(f => f.tier === 'required').map(f => f.key)
export const TIER2_KEYS = FIELD_SCHEMA.filter(f => f.tier === 'required_or_na').map(f => f.key)
export const TIER3_KEYS = FIELD_SCHEMA.filter(f => f.tier === 'optional').map(f => f.key)

export function isEmpty(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}

export function isNA(value: string | null | undefined): boolean {
  return value != null && value.trim().toUpperCase() === 'N/A'
}

export interface CompletenessResult {
  score: number
  missing_required: string[]
  needs_na_confirmation: string[]
  optional_empty: string[]
}

export function computeCompleteness(
  data: Record<string, string | null | undefined>
): CompletenessResult {
  const hasImage = (data.has_image ?? '').toUpperCase() === 'TRUE'

  const missingRequired: string[] = []
  const needsNa: string[] = []
  const optionalEmpty: string[] = []

  for (const f of FIELD_SCHEMA) {
    const val = data[f.key]
    if (f.tier === 'required') {
      if (isEmpty(val)) missingRequired.push(f.key)
    } else if (f.tier === 'required_or_na') {
      if (f.conditional === 'has_image' && !hasImage) continue
      if (isEmpty(val)) needsNa.push(f.key)
    } else {
      if (isEmpty(val)) optionalEmpty.push(f.key)
    }
  }

  let total = FIELD_SCHEMA.length
  if (!hasImage) {
    total -= FIELD_SCHEMA.filter(f => f.conditional === 'has_image').length
  }
  const filled = total - missingRequired.length - needsNa.length - optionalEmpty.length
  const score = total > 0 ? Math.round((filled / total) * 100) : 0

  return {
    score,
    missing_required: missingRequired,
    needs_na_confirmation: needsNa,
    optional_empty: optionalEmpty,
  }
}

/**
 * Returns 'red' (Tier 1 missing), 'yellow' (Tier 2/3 gaps only), or 'green' (complete).
 */
export function completenessColor(result: CompletenessResult): 'red' | 'yellow' | 'green' {
  if (result.missing_required.length > 0) return 'red'
  if (result.needs_na_confirmation.length > 0 || result.optional_empty.length > 0) return 'yellow'
  return 'green'
}
