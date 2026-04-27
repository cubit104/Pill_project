/**
 * Convert a string to a SEO-friendly URL segment using hyphens.
 * "Ethambutol Hydrochloride" -> "ethambutol-hydrochloride"
 * "light blue" -> "light-blue"
 * "Café/Crème" -> "cafe-creme"
 *
 * Diacritics are normalized and runs of non-alphanumeric characters are
 * converted to single hyphens for consistent URL segments.
 */
export function slugifyUrl(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
