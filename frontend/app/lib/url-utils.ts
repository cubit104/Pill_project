/**
 * Convert a string to a SEO-friendly URL segment using hyphens.
 * "Ethambutol Hydrochloride" -> "ethambutol-hydrochloride"
 * "light blue" -> "light-blue"
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
