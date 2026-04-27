/**
 * Convert a color or shape value to a URL-safe slug.
 *
 * Examples:
 *   "Blue"        → "blue"
 *   "BLUE; GREEN" → "blue-green"
 *   "Round"       → "round"
 */
export function slugifyUrl(value: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
