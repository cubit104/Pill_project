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
 *   "Hydralazine Hydrochloride"  → "hydralazine-hydrochloride"
 *   "Ibuprofen 200 mg"           → "ibuprofen-200-mg"
 */
export function slugifyDrugName(drugName: string): string {
  if (!drugName) return 'unknown'
  return drugName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}
