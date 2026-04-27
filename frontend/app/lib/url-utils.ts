import { classSlugify } from './slug'

/**
 * Convert a string (e.g. color or shape) to a URL-safe slug.
 *
 * Examples:
 *   "Light Blue"  → "light-blue"
 *   "Round"       → "round"
 */
export function slugifyUrl(value: string): string {
  return classSlugify(value)
}
