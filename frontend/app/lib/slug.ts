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
 * Convert a drug name to a SEO-friendly URL slug using hyphens.
 *
 * Examples:
 *   "Ethambutol Hydrochloride"  → "ethambutol-hydrochloride"
 *   "Café/Crème"                → "cafe-creme"
 */
export function slugifyDrugName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
