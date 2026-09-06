/** Shared display formatting. */

export function money(v: number | null, opts: { compact?: boolean } = {}): string {
  if (v === null) return '—'
  const maximumFractionDigits = opts.compact ? (v >= 100 ? 0 : 2) : v < 1 ? 3 : v >= 100 ? 0 : 2
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits })
}

/** "2026-08-27T12:55:24Z" or "2026-08-27" → "Aug 27, 2026"; null when unparsable. */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
