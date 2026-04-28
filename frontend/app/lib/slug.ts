/**
 * Convert a pharmacologic class name to a URL-safe slug.
 *
 * Examples:
 *   "HMG-CoA Reductase Inhibitors"  → "hmg-coa-reductase-inhibitors"
 *   "ACE Inhibitors [EPC]"           → "ace-inhibitors-epc"
 */
export function classSlugify(className: string): string {
  if (!className) return 'unknown'
  return className
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

/**
 * Convert a drug name to a Google-friendly URL slug.
 * Lowercases, strips diacritics, replaces any non-[a-z0-9] run with a single '-',
 * and trims leading/trailing dashes.
 *
 * Examples:
 *   "Mircette (28) Dp 331 Imprint Round Green 0.15mg Tablet"
 *   → "mircette-28-dp-331-imprint-round-green-0-15mg-tablet"
 *   "Amoxicillin & Clavulanate" → "amoxicillin-clavulanate"
 */
export function slugifyDrugName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
