/**
 * Convert a string (e.g. color or shape) to a URL-safe slug.
 *
 * Examples:
 *   "Light Blue"  → "light-blue"
 *   "Round"       → "round"
 */
export function slugifyUrl(value: string): string {
  if (!value) return 'unknown'
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}
