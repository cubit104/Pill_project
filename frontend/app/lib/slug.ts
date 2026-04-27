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
 * Convert a drug name to a URL-safe slug.
 *
 * Examples:
 *   "Ethambutol Hydrochloride"  → "ethambutol-hydrochloride"
 *   "21 Desogestrel/Ethinyl Estradiol"  → "21-desogestrel-ethinyl-estradiol"
 */
export function slugifyDrugName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
