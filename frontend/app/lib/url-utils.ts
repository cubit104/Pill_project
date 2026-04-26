/**
 * Convert a string to a SEO-friendly URL segment using hyphens.
 * "Ethambutol Hydrochloride" -> "ethambutol-hydrochloride"
 * "light blue" -> "light-blue"
 *
 * Note: characters other than a-z, 0-9, spaces, and hyphens are stripped.
 * This is intentional for URL safety. For drug names with special characters
 * (slashes, apostrophes, etc.), use slugifyDrugName from lib/slug.ts instead.
 */
export function slugifyUrl(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}
