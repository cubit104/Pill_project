/**
 * Condition slug helpers — mirrors services/condition_slugs.py.
 *
 * Slug rules:
 *   - Lowercase
 *   - Spaces → hyphens
 *   - Apostrophes stripped (NOT replaced with hyphen)
 *
 * Examples:
 *   "heart attack"        → "heart-attack"
 *   "parkinson's disease" → "parkinsons-disease"
 *   "adhd"                → "adhd"
 */
export function slugFromTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/'/g, '')   // strip apostrophes before hyphenating
    .replace(/\s+/g, '-')
}
