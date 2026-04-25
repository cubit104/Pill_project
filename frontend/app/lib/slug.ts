/**
 * Convert a name to a URL-safe slug (dash-separated, lowercase).
 * Shared by both classSlugify and slugifyDrugName.
 *
 * Examples:
 *   "HMG-CoA Reductase Inhibitors"  → "hmg-coa-reductase-inhibitors"
 *   "Mircette (28) DP 331"          → "mircette-28-dp-331"
 */
function toSlug(name: string): string {
  if (!name) return 'unknown'
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

/**
 * Convert a pharmacologic class name to a URL-safe slug.
 *
 * Examples:
 *   "HMG-CoA Reductase Inhibitors"  → "hmg-coa-reductase-inhibitors"
 *   "ACE Inhibitors [EPC]"           → "ace-inhibitors-epc"
 */
export function classSlugify(className: string): string {
  return toSlug(className)
}

/**
 * Convert a drug name to a URL-safe slug (dash-separated, lowercase).
 *
 * Examples:
 *   "Mircette (28) DP 331"  → "mircette-28-dp-331"
 *   "Aspirin 325 mg"        → "aspirin-325-mg"
 */
export function slugifyDrugName(name: string): string {
  return toSlug(name)
}
